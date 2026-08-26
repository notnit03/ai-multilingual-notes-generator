import os, uuid
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from database import supabase
from tasks import process_meeting
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Meeting AI")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/")
def root():
    return {"status": "Meeting AI is running"}

MAX_DURATION_SECONDS = 30 * 60  # 30 minutes
MIN_DURATION_SECONDS = 1

def get_audio_duration(path: str) -> float:
    import subprocess
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", path],
        capture_output=True, text=True,
    )
    try:
        return float(result.stdout.strip())
    except ValueError:
        return -1

@app.post("/meetings/upload")
async def upload_meeting(file: UploadFile = File(...), title: str = "Untitled Meeting"):
    meeting_id = str(uuid.uuid4())
    audio_path = f"/tmp/{meeting_id}_{file.filename}"

    with open(audio_path, "wb") as f:
        f.write(await file.read())

    duration = get_audio_duration(audio_path)

    if duration < 0:
        os.remove(audio_path)
        raise HTTPException(status_code=400, detail="Could not read this file. Please upload a valid audio file (MP3, WAV, or M4A).")

    if duration < MIN_DURATION_SECONDS:
        os.remove(audio_path)
        raise HTTPException(status_code=400, detail="This file is too short to transcribe. Please upload a longer recording.")

    if duration > MAX_DURATION_SECONDS:
        os.remove(audio_path)
        raise HTTPException(status_code=400, detail=f"This file is longer than the {MAX_DURATION_SECONDS // 60}-minute limit. Please upload a shorter recording.")

    supabase.table("meetings").insert({
        "id": meeting_id,
        "title": title,
        "status": "pending"
    }).execute()

    process_meeting.delay(meeting_id, audio_path)

    return {"meeting_id": meeting_id, "status": "pending"}

@app.get("/meetings/{meeting_id}/status")
def get_status(meeting_id: str):
    result = supabase.table("meetings").select("id, title, status").eq("id", meeting_id).single().execute()
    return result.data

@app.get("/meetings/{meeting_id}/notes")
def get_notes(meeting_id: str):
    meeting = supabase.table("meetings").select("*").eq("id", meeting_id).single().execute()
    segments = supabase.table("segments").select("*").eq("meeting_id", meeting_id).execute()
    notes = supabase.table("notes").select("*").eq("meeting_id", meeting_id).single().execute()
    return {"meeting": meeting.data, "segments": segments.data, "notes": notes.data}
