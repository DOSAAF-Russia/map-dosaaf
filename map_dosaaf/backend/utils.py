from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from map_dosaaf.common.config import get_config


def get_sqlalchemy_async_engine():
    cfg = get_config()
    eng = create_async_engine(cfg["db"]["url"])
    return eng

def get_sqlalchemy_async_sessionmaker():
    eng = get_sqlalchemy_async_engine()
    return async_sessionmaker(eng, expire_on_commit=False)
