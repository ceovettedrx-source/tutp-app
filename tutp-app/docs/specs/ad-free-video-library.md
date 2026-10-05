# Ad-free video library (phase 2, spec only, nothing built)

Status: spec. The code only carries the ordering field (`source`: `tutp_hosted` before `youtube`, `server/video/service.js` `SOURCE_PRIORITY`) and a `localVideos(conceptId)` hook that returns nothing today. Written 2026-10-05 with experiential-learning-v2.

## Why
YouTube embeds show ads we may not hide, skip or overlay (YouTube API Services terms), and a Class 6 child can land on a related-video rail. Teachers already explain these concepts well in Telugu, Hindi and English. A library of short, tagged teacher clips on our own storage is ad-free, curated, and the only way to get a local-language "key part" without relying on a stranger's chapter list. We never claim a YouTube video is ad-free; only `tutp_hosted` ones may be labelled so.

## Upload flow (teacher)
1. Teacher (existing teacher login) opens "Add a video": picks a file (mp4/mov/webm, up to 500 MB, up to 20 min).
2. Form: concept (from the 12 pilot concepts, later the KG), class, language, a title, and the licence step below.
3. Server stores the original in a private bucket `tutp-video-originals` (never public), then a job:
   - **Silence trim:** drop leading and trailing silence and any silence over 3 s inside (ffmpeg `silenceremove`, threshold -35 dB); show the teacher the before/after length and let them undo.
   - **Clip split:** cut into clips at scene or long-pause boundaries (ffmpeg scene detect plus the 3 s pauses), each 1 to 8 minutes. The teacher confirms or merges clips in a simple list. One clip = one `segment` for one concept; the "Key part" button plays the clip with the best concept tag, "Watch full video" plays the whole upload.
   - **Lesson tags:** a cheap model call proposes concept, class and a 3-point summary from the transcript (speech-to-text); the teacher approves. Nothing is published untagged.
   - **Transcode:** HLS ladder (360p and 720p H.264/AAC) for phones on weak networks; a poster frame and a caption file (WebVTT) are produced.
4. Review: a founder or reviewer approves (child-appropriateness, accuracy, our safety rules for anything shown on screen: no flame, mains electricity or sharp tools). Only then does the video appear (`status: approved`).

## Licence check (blocking)
Accept only a video the uploader owns or one under **CC BY** or **CC BY-SA**. Reject any **NC** (non-commercial) and any **ND** (no derivatives) licence, because we trim and clip (derivative) and we run a commercial product. Rules:
- Uploader picks one: "I made this video and give Tut-P the licence below", or "This video is CC BY / CC BY-SA" with the source URL and the licence URL (required; the server fetches the page and must see the licence text; a mismatch blocks).
- Anything else, including "all rights reserved", "CC BY-NC", "CC BY-ND", "CC BY-NC-SA", "CC BY-NC-ND", "standard YouTube licence", is rejected with the reason shown.
- Own videos: the teacher signs the creator agreement (next section) with a typed name, date and IP, stored with the video row.
- Store licence, attribution line, source URL and the checked-on date; show the attribution under the player ("Video by <name>, CC BY 4.0").
- CC BY-SA clips: our clips of them stay CC BY-SA and say so; we never mix them into an All-rights-reserved package.

## Creator permission and revenue share
- **Creator agreement** (plain English, reviewed by a lawyer before launch): the teacher keeps ownership, grants Tut-P a non-exclusive licence to host, trim, clip, caption and show the video inside Tut-P, may withdraw any time (video hidden within 24 hours, already printed copies unaffected), warrants they own it or have the rights, and that no child appears without a guardian's consent.
- **Revenue share (proposal for the founder to decide):** a monthly pool of 20% of the Pro subscription revenue from families who watched, split by watch time among hosted creators, paid when a creator passes Rs 500. Start with a flat thank-you (Rs 500 per approved video) during the pilot. The share, the threshold and the pool percentage are open decisions, not built.
- **Takedown:** a visible "Report this video" button; three reports from different families hide it for review (same rule as the story image library).

## Where it lives
`videos` table (id, teacher id, concept id, class, language, title, licence, licence_url, attribution, status, duration, clips JSON, created_at) and a public bucket for the HLS output behind Cloud CDN. This needs a database migration, so it is a separate release. The player: our own `<video>` with HLS (hls.js), captions, no ads, no autoplay; the same "Key part" and "Watch full video" controls. Hosted videos sort first in the 2+2+1 list.

## Cost estimate (public list prices, to be checked before launch)
- Storage: 500 videos averaging 5 min; originals about 150 MB each (75 GB) plus 360p and 720p renditions about 40 MB each (20 GB). About 95 GB at about $0.02 per GB-month: roughly **$2 per month**.
- Transcoding: 2,500 minutes at about $0.03 to $0.06 per output minute across two renditions: roughly **$75 to $150 once**, plus about $0.15 per added minute afterwards.
- Delivery: a 3-minute watch at 720p is about 25 MB. At 10,000 plays a month that is 250 GB; at about $0.05 to $0.09 per GB through Cloud CDN, **about $12 to $23 per month**, growing linearly with plays (100,000 plays about $120 to $230). Cache hit rate above 80% on a popular concept lowers it.
- Speech-to-text for tags and captions: about $0.016 per minute, **about $40 once** for 2,500 minutes.
- So the first 500 videos cost about **$120 to $200 once** and **$15 to $30 per month** at 10,000 plays, before any creator payments.

## Open decisions for the founder
Revenue-share percentage and threshold, who reviews uploads, whether to start with five paid teachers, and the lawyer review of the agreement. Nothing here changes live behaviour until the `videos` migration is approved.
