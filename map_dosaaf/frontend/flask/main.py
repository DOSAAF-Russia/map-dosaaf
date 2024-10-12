from datetime import datetime, time
import json
from flask import Flask, Response, render_template, request, send_from_directory, make_response
from flask_cors import CORS
import pandas as pd
import numpy as np
from shapely.geometry import mapping, shape
import orjson
from git import Repo
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from map_dosaaf.backend.database import prepare_db
from map_dosaaf.backend.database.models import SqliteBase
from map_dosaaf.common.app_types import FeedbackType, OfferType, Organisation
from map_dosaaf.backend.database.repos import ECRepository, FeedbackRepository, OfferRepository, OrganisationRepository
from map_dosaaf.backend.utils import get_sqlalchemy_async_sessionmaker

app = Flask(__name__)
CORS(app)


class Storage:
    def __init__(self) -> None:
        self._points: list[Organisation] = []
        self._db_sessionmaker = get_sqlalchemy_async_sessionmaker()
        eng = create_async_engine("sqlite+aiosqlite:///utils-database.db")
        self._sqlite_sessionmaker = async_sessionmaker(eng)
        self._feedback_repo = FeedbackRepository(self._sqlite_sessionmaker())
        self._offer_repo = OfferRepository(self._sqlite_sessionmaker())

    async def load_points(self):
        async with self._db_sessionmaker() as session:
            repo_orgs = OrganisationRepository(session)
            repo_ec = ECRepository(session)
            
            self._points = await repo_orgs.get_all()
            self._ec = await repo_ec.get_all()
        
        with open("data/Федеральные_округа-Регионы.json") as f:
            fd = json.load(f)
            
            fds = []
            for fd_item in fd:
                obj = {}
                obj["name"] = fd_item["name"]

                geojson = shape(fd_item["geojson"])
                simple_geojson = geojson.simplify(0.05, preserve_topology=True)
                obj["geojson"] = mapping(simple_geojson)
                # obj["geojson"] = fd_item["geojson"]
                fds.append(obj)

            self._fd = fds
            
        with open("data/Военные-Округа.json") as f:
            md = json.load(f)
            mds = []
            
            for md_name in md:
                obj = {}
                obj["name"] = md_name
                obj["childs"] = []
                for md_item in md[md_name]:
                    obj_child = {}
                    obj_child["geojson"] = md_item["geojson"]
                    obj_child["name"] = md_item["name"]
                    obj["childs"].append(obj_child)
                    mds.append(obj)
            
            self._md = mds

    @property
    def points(self):
        return self._points
    
    @property
    def ecs(self):
        return self._ec
    
    @property
    def md(self):
        return self._md
    
    @property
    def fd(self):
        return self._fd
    
    @property
    def feedback_repo(self):
        return self._feedback_repo
    
    @property
    def offer_repo(self):
        return self._offer_repo


o = Storage()


@app.get("/")
async def index():
    commits = [
        {
            "message": commit.message.rstrip("\n"),
            "author": f"Даниил Толмачев ({commit.author.name})" 
            if commit.author.name == 'dev.tolmachev' 
            else commit.author.name 
            if commit.author.name else "Unknown",
            "date": datetime.fromtimestamp(commit.committed_date).strftime("%H:%M:%S %Y-%m-%d")
        }
        for commit in Repo(".").iter_commits()
    ]
    
    # feedbacks = [
    #     {"message": "test", "date": datetime.now().timestamp(), "review": 5}
    # ]
    
    # offers = [
    #     {"message": "test", "author": "test", "date": datetime.now().timestamp()}
    # ]
    
    feedbacks = [f.model_dump() for f in await o.feedback_repo.get_all()]
    offers = [o.model_dump() for o in await o.offer_repo.get_all()]
    
    return render_template("index.html", commits=commits, feedbacks=feedbacks, offers=offers)



@app.post("/api/feedback")
async def api_feedback():
    data = json.loads(request.get_data(as_text=True))
    if data["review"].lower().count("не хочу"):
        data["review"] = ""
    data["date"] = str(datetime.now().timestamp())
        
    await o.feedback_repo.add(FeedbackType(**data))
    return {"status": "ok"}


@app.post("/api/offer")
async def api_offer():
    data = json.loads(request.get_data(as_text=True))
    data["date"] = str(datetime.now().timestamp())
    
    await o.offer_repo.add(OfferType(**data))
    return {"status": "ok"}


@app.template_filter('strftime')
def strftime(date, format):
    return datetime.fromtimestamp(float(date)).strftime(format)


@app.get("/map_view")
def map_view():
    return render_template("map.html")


@app.get("/api/organizations")
async def api_organizations():
    eins = request.args.getlist("ein")
    if not eins:
        return [org.model_dump() for org in o.points if org.address]
    else:
        return [org.model_dump() for org in o.points if org.address and str(org.ein) in list(map(str, eins))]


@app.get("/api/ec")
async def api_ec():
    return [ec.model_dump() for ec in o.ecs if ec.address]


@app.get("/api/fd")
async def api_fd():
    def generate():
        for fd_item in o.fd:
            yield orjson.dumps(fd_item).decode("utf-8") + "\n\n"

    return app.response_class(generate(), mimetype="application/json")


@app.get("/api/md")
async def api_md():
    def generate():
        for md_item in o.md:
            yield orjson.dumps(md_item).decode("utf-8") + "\n\n"

    return app.response_class(generate(), mimetype="application/json")


@app.route("/script.js")
def script_js():
    response = make_response(
        render_template("script.js")
    )
    response.mimetype = "application/javascript"
    return response


async def main():
    sqlite_conn = create_async_engine("sqlite+aiosqlite:///utils-database.db")
    async with sqlite_conn.begin() as conn:
        await conn.run_sync(SqliteBase.metadata.create_all)
    
    await o.load_points()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
    app.run("127.0.0.1", 5050, debug=True)
