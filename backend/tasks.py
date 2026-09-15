import os, json, subprocess, glob, whisper
from celery import Celery
from database import supabase, update_status
from groq import Groq
from dotenv import load_dotenv

os.environ["PATH"] = "/opt/homebrew/bin:" + os.environ.get("PATH", "")
load_dotenv()

celery = Celery("tasks", broker=os.environ.get("REDIS_URL", "redis://localhost:6379"))
groq_client = Groq(api_key=os.environ["GROQ_API_KEY"])
GROQ_MODEL = os.environ.get("GROQ_MODEL", "openai/gpt-oss-20b")

CHUNK_SECONDS = 12

def split_audio(audio_path: str, meeting_id: str) -> list[str]:
    chunk_dir = f"/tmp/{meeting_id}_chunks"
    os.makedirs(chunk_dir, exist_ok=True)
    pattern = f"{chunk_dir}/chunk_%03d.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path, "-f", "segment",
         "-segment_time", str(CHUNK_SECONDS), "-c", "copy", pattern],
        check=True, capture_output=True,
    )
    return sorted(glob.glob(f"{chunk_dir}/chunk_*.mp3"))

@celery.task
def process_meeting(meeting_id: str, audio_path: str):
    try:
        update_status(meeting_id, "transcribing")
        model = whisper.load_model("small")

        chunk_paths = split_audio(audio_path, meeting_id)
        all_segments = []
        time_offset = 0.0

        for chunk_path in chunk_paths:
            result = model.transcribe(chunk_path, task="translate", condition_on_previous_text=False)
            chunk_language = result["language"]

            for s in result["segments"]:
                low_confidence = s.get("avg_logprob", 0) < -0.8
                likely_not_speech = s.get("no_speech_prob", 0) > 0.5
                empty_text = not s["text"].strip()
                needs_review = low_confidence or likely_not_speech or empty_text

                all_segments.append({
                    "meeting_id": meeting_id,
                    "speaker": "Speaker",
                    "start": s["start"] + time_offset,
                    "text": s["text"],
                    "language": chunk_language,
                    "needs_review": needs_review,
                })

            time_offset += CHUNK_SECONDS

        if all_segments:
            supabase.table("segments").insert(all_segments).execute()

        for p in chunk_paths:
            os.remove(p)
        os.rmdir(f"/tmp/{meeting_id}_chunks")

        update_status(meeting_id, "generating")

        meaningful_segments = [s for s in all_segments if s["text"].strip()]

        if not meaningful_segments:
            supabase.table("notes").insert({
                "meeting_id": meeting_id,
                "summary": "No speech was detected in this recording. It may be silent, too quiet, or contain only background noise.",
                "action_items": [],
                "decisions": [],
                "languages": {},
            }).execute()
            update_status(meeting_id, "done")
            return

        transcript_text = "\n".join(
            f"[{s['start']:.0f}s] (originally {s['language']}) {s['text']}" for s in all_segments
        )

        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{
                "role": "user",
                "content": f"""You are an expert meeting analyst. This transcript has already been translated to English from a multilingual meeting; each line shows its original source language in parentheses. Given this transcript, return ONLY a valid JSON object with:
- summary: 3-5 sentence overview
- action_items: list of {{task, owner, deadline}}
- decisions: list of {{decision, context}}
- languages: {{language_code: percentage}} breakdown, based on the original source languages noted in the transcript

Transcript:
{transcript_text}"""
            }],
            response_format={"type": "json_object"}
        )

        notes = json.loads(response.choices[0].message.content)
        supabase.table("notes").insert({"meeting_id": meeting_id, **notes}).execute()
        update_status(meeting_id, "done")

    except Exception as e:
        update_status(meeting_id, "error")
        raise e
