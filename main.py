# main.py   ←  ONE FILE. MODERN AI SAAS STYLE. 100% WORKING
from fastapi import FastAPI, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import uuid
import shutil
import threading
import time
from collections import deque
from pipeline import youtube_to_stems


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins for local dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory="static", html=True), name="static")
templates = Jinja2Templates(directory="templates")


OUTPUT_ROOT = Path("./temp_jobs")
OUTPUT_ROOT.mkdir(exist_ok=True)



# Job queue and worker
job_queue = deque()
queue_lock = threading.Lock()
current_job = None
completed_jobs = []  # In-memory session-only completed jobs


def job_worker():
    global current_job, completed_jobs
    while True:
        with queue_lock:
            if job_queue:
                job = job_queue.popleft()
                current_job = job
            else:
                current_job = None
        if current_job:
            job_id, url, name, mode = current_job["job_id"], current_job["url"], current_job["name"], current_job.get("mode", "stem")
            job_dir = OUTPUT_ROOT / job_id
            try:
                (job_dir / "status.txt").write_text("downloading")
                stems = []
                bpm = None
                key = None
                if mode == "youtube":
                    # Only download mp3, do not split
                    from converter import download_yt_to_mp3
                    mp3_path = job_dir / name / f"{name}.mp3"
                    (job_dir / name).mkdir(parents=True, exist_ok=True)
                    title, duration = download_yt_to_mp3(url, str(mp3_path), max_duration=360)
                    stems.append({
                        "name": f"{name}[full].mp3",
                        "url": f"/download/{job_id}/{name}/{name}.mp3"
                    })
                    (job_dir / "status.txt").write_text("done")
                else:
                    from pipeline import youtube_to_stems
                    youtube_to_stems(url, name, str(job_dir))
                    (job_dir / "status.txt").write_text("done")
                    # Collect stems and metadata for completed jobs
                    song_dir = job_dir / name
                    metadata_file = job_dir / "metadata.txt"
                    if metadata_file.exists():
                        try:
                            metadata = metadata_file.read_text().strip()
                            for line in metadata.split('\n'):
                                if line.startswith('BPM:'):
                                    bpm = line.replace('BPM:', '').strip()
                                elif line.startswith('Key:'):
                                    key = line.replace('Key:', '').strip()
                        except Exception:
                            pass
                    if song_dir.exists():
                        for f in song_dir.iterdir():
                            if f.is_file():
                                stems.append({
                                    "name": f.name,
                                    "url": f"/download/{job_id}/{name}/{f.name}"
                                })
                completed_jobs.append({
                    "job_id": job_id,
                    "song_name": name,
                    "stems": stems,
                    "bpm": bpm,
                    "key": key,
                    "url": url
                })
            except Exception as e:
                (job_dir / "status.txt").write_text("error")
                (job_dir / "error.txt").write_text(str(e))
        else:
            time.sleep(1)

worker_thread = threading.Thread(target=job_worker, daemon=True)
worker_thread.start()

# Endpoint to list completed jobs for this session only
@app.get("/completed")
async def completed_jobs_endpoint():
    # Most recent first
    return JSONResponse({"completed": list(reversed(completed_jobs))})


@app.post("/remove_job/{job_id}")
async def remove_job(job_id: str):
    with queue_lock:
        for i, job in enumerate(job_queue):
            if job["job_id"] == job_id:
                job_queue.remove(job)
                return JSONResponse({"removed": True})
    return JSONResponse({"removed": False, "reason": "Not found"}, status_code=404)


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})



@app.post("/start")
async def start(url: str = Form(...), name: str = Form(...), mode: str = Form('stem')):
    job_id = str(uuid.uuid4())[:8]
    job_dir = OUTPUT_ROOT / job_id
    final_dir = job_dir / name
    final_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "status.txt").write_text("queued")
    job = {"job_id": job_id, "url": url, "name": name, "mode": mode}
    with queue_lock:
        job_queue.append(job)
    return JSONResponse({"job_id": job_id, "song_name": name, "output_folder": str(final_dir)})
# New endpoint: get current job queue
@app.get("/queue")
async def get_queue():
    with queue_lock:
        queue_list = list(job_queue)
    return JSONResponse({"queue": queue_list, "current_job": current_job})


@app.get("/job/{job_id}/{song_name}", response_class=HTMLResponse)
async def job_page(request: Request, job_id: str, song_name: str):
    return templates.TemplateResponse("index.html", {
        "request": request,
        "job_id": job_id,
        "song_name": song_name,
        "OUTPUT_ROOT": OUTPUT_ROOT
    })


@app.get("/download/{job_id}/{song_name}/{filename}")
async def download(job_id: str, song_name: str, filename: str):
    return FileResponse(OUTPUT_ROOT / job_id / song_name / filename, filename=filename)


@app.get("/zip/{job_id}/{song_name}")
async def zip_download(job_id: str, song_name: str):
    folder = OUTPUT_ROOT / job_id / song_name
    zip_path = OUTPUT_ROOT / f"{job_id}_{song_name}.zip"
    shutil.make_archive(zip_path.with_suffix(""), "zip", folder)
    return FileResponse(f"{zip_path}.zip", filename=f"{song_name}_stems.zip")


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    """Get the current status of a job"""
    status_file = OUTPUT_ROOT / job_id / "status.txt"
    if not status_file.exists():
        return JSONResponse({"status": "not_found"}, status_code=404)
    
    status = status_file.read_text().strip()
    error = None
    bpm = None
    key = None
    progress = None
    
    if status == "error":
        error_file = OUTPUT_ROOT / job_id / "error.txt"
        if error_file.exists():
            error = error_file.read_text().strip()
    elif status == "done":
        # Read metadata if available
        metadata_file = OUTPUT_ROOT / job_id / "metadata.txt"
        if metadata_file.exists():
            try:
                metadata = metadata_file.read_text().strip()
                for line in metadata.split('\n'):
                    if line.startswith('BPM:'):
                        bpm = line.replace('BPM:', '').strip()
                    elif line.startswith('Key:'):
                        key = line.replace('Key:', '').strip()
            except:
                pass
    
    return JSONResponse({"status": status, "error": error, "bpm": bpm, "key": key, "progress": progress})


@app.get("/files/{job_id}/{song_name}")
async def list_files(job_id: str, song_name: str):
    """List all files available for download for a completed job"""
    folder = OUTPUT_ROOT / job_id / song_name
    if not folder.exists():
        return JSONResponse({"files": []}, status_code=404)
    
    files = []
    for file_path in folder.iterdir():
        if file_path.is_file():
            files.append({
                "name": file_path.name,
                "url": f"/download/{job_id}/{song_name}/{file_path.name}"
            })
    
    return JSONResponse({"files": files})