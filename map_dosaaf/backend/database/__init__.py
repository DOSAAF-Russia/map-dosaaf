

from map_dosaaf.backend.database.models import Base
from map_dosaaf.backend.utils import get_sqlalchemy_async_engine


async def prepare_db():
    eng = get_sqlalchemy_async_engine()
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
