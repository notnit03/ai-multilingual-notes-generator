from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class MeetingCreate(BaseModel):
    title: Optional[str] = "Untitled Meeting"

class SegmentOut(BaseModel):
    speaker: Optional[str]
    start: Optional[float]
    text: str
    language: Optional[str]

class NotesOut(BaseModel):
    summary: str
    action_items: list
    decisions: list
    languages: dict

class MeetingOut(BaseModel):
    id: str
    title: str
    status: str
    created_at: Optional[datetime]
    segments: Optional[List[SegmentOut]] = []
    notes: Optional[NotesOut] = None
