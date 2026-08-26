import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_KEY"]
)

def update_status(meeting_id: str, status: str):
    supabase.table("meetings").update({"status": status}).eq("id", meeting_id).execute()
