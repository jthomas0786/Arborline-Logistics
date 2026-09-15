from pathlib import Path
import subprocess, json, shutil

recordings = Path('dist/recordings')
audio = Path('dist/audio')
out = Path('dist/final')
out.mkdir(parents=True, exist_ok=True)

pairs = [
    ('01_ArborLine_End_to_End_Demo_LinkedIn_X', 'voice_full.mp3'),
    ('02_Prospect_Discovery_LinkedIn_X', 'voice_discover.mp3'),
    ('03_Decision_Maker_Enrichment_LinkedIn_X', 'voice_contact.mp3'),
    ('04_Personalized_Outreach_LinkedIn_X', 'voice_outreach.mp3'),
    ('05_Reply_Intelligence_90_Second_Video_LinkedIn_X', 'voice_reply.mp3'),
    ('06_Qualified_Handoff_LinkedIn_X', 'voice_handoff.mp3'),
]

def duration(path: Path) -> float:
    raw = subprocess.check_output([
        'ffprobe','-v','error','-show_entries','format=duration',
        '-of','json',str(path)
    ], text=True)
    return float(json.loads(raw)['format']['duration'])

for stem, audio_name in pairs:
    video_path = recordings / f'{stem}.webm'
    audio_path = audio / audio_name
    final_path = out / f'{stem}_Website_Colors_AI_Voice.mp4'
    vdur = duration(video_path)
    adur = duration(audio_path)
    delay = 0.45
    target = max(vdur, adur + delay) + 0.20
    pad = max(0.0, target - vdur)
    filter_complex = (
        f'[0:v]tpad=stop_mode=clone:stop_duration={pad:.3f},format=yuv420p[v];'
        f'[1:a]adelay={int(delay*1000)}:all=1,loudnorm=I=-16:TP=-1.5:LRA=11,'
        f'apad=pad_dur={target:.3f}[a]'
    )
    subprocess.run([
        'ffmpeg','-y','-loglevel','error','-i',str(video_path),'-i',str(audio_path),
        '-filter_complex',filter_complex,'-map','[v]','-map','[a]','-t',f'{target:.3f}',
        '-c:v','libx264','-preset','medium','-crf','18','-c:a','aac','-b:a','160k',
        '-movflags','+faststart',str(final_path)
    ], check=True)
    print(final_path, 'video', round(vdur,2), 'voice', round(adur,2), 'final', round(target,2))

archive = shutil.make_archive('dist/ArborLine_LinkedIn_X_Website_Colors_AI_Voice', 'zip', out)
print(archive)
