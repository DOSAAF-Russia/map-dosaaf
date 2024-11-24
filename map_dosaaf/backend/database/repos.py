from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, insert
from sqlalchemy.engine.cursor import CursorResult
from pydantic import BaseModel

from map_dosaaf.backend.database.models import EC, Feedback, Offer, Organisation
from map_dosaaf.common.app_types import NULL, FeedbackType, OfferType, Organisation as OrganisationType, EC as ECType


def convert_model(model: BaseModel) -> dict:
    obj = {}
    for field in model.model_fields:
        val = getattr(model, field)
        if val != NULL:
            obj[field] = val

    return obj


class SQLAlchemyRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _execute_stmt(self, stmt) -> CursorResult:
        conn = await self._session.connection()
        return await conn.execute(stmt)

    async def add(self, stmt):
        raise NotImplementedError

    async def get(self, stmt):
        raise NotImplementedError

    async def delete(self, stmt):
        raise NotImplementedError

    async def update(self, stmt):
        raise NotImplementedError


class OrganisationRepository(SQLAlchemyRepository):
    _model = Organisation

    async def get(self, ein: int) -> Optional[OrganisationType]:
        stmt = select(self._model).where(self._model.ein == ein)
        res = await self._execute_stmt(stmt)
        result = res.fetchone()

        if result:
            return OrganisationType(**result._asdict())

    async def get_all(self) -> Optional[OrganisationType]:
        stmt = select(self._model)
        res = await self._execute_stmt(stmt)
        result = res.fetchall()

        if result:
            return [OrganisationType(**r._asdict()) for r in result]

    async def add(self, obj: OrganisationType):
        values = convert_model(obj)
        stmt = insert(self._model).values(**values)
        await self._execute_stmt(stmt)
        await self._session.commit()


class ECRepository(SQLAlchemyRepository):
    _model = EC

    async def get(self, name: str) -> Optional[ECType]:
        stmt = select(self._model).where(self._model.name == name)
        res = await self._execute_stmt(stmt)
        result = res.fetchone()

        if result:
            return ECType(**result._asdict())

    async def get_all(self) -> list[Optional[ECType]]:
        stmt = select(self._model)
        res = await self._execute_stmt(stmt)
        result = res.fetchall()

        if result:
            return [ECType(**r._asdict()) for r in result]

    async def add(self, obj: ECType):
        values = convert_model(obj)
        stmt = insert(self._model).values(**values)
        await self._execute_stmt(stmt)
        await self._session.commit()



class FeedbackRepository(SQLAlchemyRepository):
    _model = Feedback

    async def get_all(self) -> list[FeedbackType | None]:
        stmt = select(self._model)
        res = await self._execute_stmt(stmt)
        result = res.fetchall()

        if result:
            return [FeedbackType(**r._asdict()) for r in result]
        return []
        
    async def add(self, obj: FeedbackType):
        values = convert_model(obj)
        stmt = insert(self._model).values(**values)
        await self._execute_stmt(stmt)
        await self._session.commit()

class OfferRepository(SQLAlchemyRepository):
    _model = Offer
    
    async def get_all(self) -> list[OfferType | None]:
        stmt = select(self._model)
        res = await self._execute_stmt(stmt)
        result = res.fetchall()

        if result:
            return [OfferType(**r._asdict()) for r in result]
        return []

    async def add(self, obj: OfferType):
        values = convert_model(obj)
        stmt = insert(self._model).values(**values)
        await self._execute_stmt(stmt)
        await self._session.commit()
