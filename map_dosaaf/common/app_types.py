from datetime import datetime
from typing import TypeVar
from pydantic import BaseModel, ConfigDict


NULL = TypeVar("NULL")


class Organisation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    full_name: str
    state: str | NULL = NULL
    
    ein: str
    kpp: str | NULL = NULL
    
    contact_emails: list[str]
    contact_phones: list[str]
    websites: list[str]
    
    type_org: str | NULL = NULL
    
    coords: list[str]
    address: list[str]
    federal_district: str | NULL = NULL
    region: str | NULL = NULL
    
    link_listorg: str | NULL = NULL
    
    personals: int | NULL = NULL

class EC(BaseModel):
    name: str
    type_ec: str
    organisations: list[str] = []
    federal_district: str
    region: str
    coords: list[str] = []
    address: str | NULL = NULL



### Sqlite models types. [ONLY UTILS]

class FeedbackType(BaseModel):
    message: str
    author: str
    review: str
    date: str
    """timestamp"""

class OfferType(BaseModel):
    message: str
    author: str
    date: str
    """timestamp"""

### Sqlite models types. [ONLY UTILS]
