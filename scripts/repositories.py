import asyncio

import orjson

from map_dosaaf.backend.database.repos import ECRepository
from map_dosaaf.backend.utils import get_sqlalchemy_async_sessionmaker


async def get_ecs_from_db_as_dict():
    sessionmaker = get_sqlalchemy_async_sessionmaker()
    async with sessionmaker() as session:
        repo = ECRepository(session)
        ecs = await repo.get_all()
        
    json_data = orjson.dumps([ec.model_dump() for ec in ecs], option=orjson.OPT_INDENT_2).decode()
    return json_data


async def main():
    json_data = await get_ecs_from_db_as_dict()
    # with open("data/Единые_центры.json", "w") as f:
    #     f.write(json_data)


if __name__ == "__main__":
    asyncio.run(main())
