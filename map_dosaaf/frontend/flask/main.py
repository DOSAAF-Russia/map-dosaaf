from datetime import datetime
import json
from flask import Flask, Response, render_template, request, send_from_directory, make_response
from flask_cors import CORS
import pandas as pd
import numpy as np
from shapely.geometry import mapping, shape
import orjson

from map_dosaaf.backend.database import prepare_db
from map_dosaaf.common.app_types import Organisation
from map_dosaaf.backend.database.repos import ECRepository, OrganisationRepository
from map_dosaaf.backend.utils import get_sqlalchemy_async_sessionmaker

app = Flask(__name__)
CORS(app)


class Storage:
    def __init__(self) -> None:
        self._points: list[Organisation] = []
        self._db_sessionmaker = get_sqlalchemy_async_sessionmaker()
        pass

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
                
                # if fd_item["name"].count("Республика Северная Осетия"):
                #     import geopy
                #     coder = geopy.Nominatim(user_agent="/app/643")
                #     d = coder.geocode("Северная Осетия", geometry="geojson")
                #     fd_item["geojson"]
                
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


o = Storage()


@app.get("/")
async def index():
    return render_template("index.html")


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
    center = [63.31122971681907, 92.47689091219665]
    zoom = 3
    response = make_response(
        render_template("script.js", center=center, zoom=zoom)
    )
    response.mimetype = "application/javascript"
    return response


async def main():
    await o.load_points()
    # print(o.points)


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
    app.run("127.0.0.1", 5050, debug=True)
