from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column, DeclarativeBase
from sqlalchemy import String, Integer, Date, ARRAY
from sqlalchemy.dialects.postgresql import JSONB


class Base(DeclarativeBase):
    pass


class Organisation(Base):
    __tablename__ = "organisations"
    full_name: Mapped[str] = mapped_column(String, nullable=False)
    state: Mapped[str] = mapped_column(String, nullable=True)
    
    ein: Mapped[str] = mapped_column(String, primary_key=True)
    ogrn: Mapped[str] = mapped_column(String, nullable=True)
    kpp: Mapped[str] = mapped_column(String, nullable=True)
    contact_emails: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    contact_phones: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    websites: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    type_org: Mapped[str] = mapped_column(String, nullable=True)
    
    coords: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    address: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    
    federal_district: Mapped[str] = mapped_column(String, nullable=True)
    region: Mapped[str] = mapped_column(String, nullable=True)
    
    link_listorg: Mapped[str] = mapped_column(String, nullable=True)
    personals: Mapped[int] = mapped_column(Integer, nullable=True)


class EC(Base):
    __tablename__ = "ec"
    name: Mapped[str] = mapped_column(String, primary_key=True)
    type_ec: Mapped[str] = mapped_column(String, nullable=False)
    
    organisations: Mapped[list[Organisation]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    federal_district: Mapped[str] = mapped_column(String, nullable=False)
    region: Mapped[str] = mapped_column(String, nullable=False)
    
    coords: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )
    address: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, default=[]
    )


### Sqlite models. [ONLY UTILS]

class SqliteBase(DeclarativeBase):
    pass

class Feedback(SqliteBase):
    __tablename__ = "feedbacks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message: Mapped[str] = mapped_column(String, nullable=False)
    author: Mapped[str] = mapped_column(String, nullable=False)
    review: Mapped[str] = mapped_column(Integer, nullable=False)
    date: Mapped[str] = mapped_column(String, nullable=False)

class Offer(SqliteBase):
    __tablename__ = "offers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message: Mapped[str] = mapped_column(String, nullable=False)
    author: Mapped[str] = mapped_column(String, nullable=False)
    date: Mapped[str] = mapped_column(String, nullable=False)

### Sqlite models. [ONLY UTILS]

