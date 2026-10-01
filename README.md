# Web Job Scraper

A Firefox extension that saves the jobs you look at on LinkedIn, so Job Finder can add the ones that fit your search.

It only reads the pages you open yourself. It never clicks, scrolls, or opens anything on its own.

**Sites:** LinkedIn now. Indeed and Glassdoor come next.

## How it works

1. You browse LinkedIn jobs as usual, in Firefox Developer Edition.
2. The extension saves each job it sees into a file in your Downloads folder, one file per site per day. It saves at most every 5 minutes and again when you close the LinkedIn tab.
3. Next time you open Job Finder, the Search page asks: *"Found 1 new capture file… Move them to web-job-scraper\searches and import them?"*
4. Click **Yes**. Job Finder moves the files, checks each job against your profile, and adds the ones that fit. Click **Not now** and it asks again when new files arrive.

## One-time setup

1. Install **Firefox Developer Edition** and sign in to LinkedIn there.
2. In the address bar, open `about:config` and set:
   - `xpinstall.signatures.required` → `false`. This lets Firefox install your own extension.
   - `browser.download.alwaysOpenPanel` → `false`. This stops the downloads panel from popping open each time the extension saves.
3. Build the extension: in this folder, run
   `powershell -ExecutionPolicy Bypass -File build.ps1`
   This creates `dist\web-job-scraper-vX.Y.Z.xpi`. To update later, install the newer `.xpi` the same way.
4. In Firefox, open `about:addons`, click the gear icon, choose **Install Add-on From File…**, and pick the `.xpi`. It stays installed after restarts.
5. Pin the extension's toolbar icon (a magnifying glass over a briefcase) so you can see its panel.

**Updating:** Firefox installs new versions by itself, about once a day. To update straight away, click **Check for updates** in the extension's panel. If there's a newer version, the project's install page opens: click **Install**, then **Add** in Firefox's prompt. (The first time, Firefox may ask you to **Allow** jltkerig.github.io first.) Firefox only allows installs from a click on a web page, which is why the install page is needed. The gear menu's **Check for Updates** in `about:addons` also works. New versions are published on the project's GitHub Pages site (`https://jltkerig.github.io/web-job-scraper/updates.json`), which is also the `update_url` that the gear menu's **Check for Updates** in `about:addons` reads.

**Publishing a new version:** raise `version` in `extension\manifest.json`, then run `powershell -ExecutionPolicy Bypass -File release.ps1`. It builds the extension and puts the install file and `updates.json` in `docs\`. Commit and push, and the update is live a minute or two later.

**While changing the code:** use `about:debugging` → **This Firefox** → **Load Temporary Add-on…** and pick `extension\manifest.json`. **Reload** there picks up changes straight away. Temporary add-ons are removed when Firefox closes.

## The toolbar panel

- **LinkedIn — On:** turns capture on or off.
- **Today:** jobs seen, jobs opened (full details captured) and jobs that are new today.
- **Saved … ago:** when the day's file was last written. **Save now** writes it straight away.
- **Check for updates:** if there's a newer version, the install page opens; click **Install**, then **Add**. The version you have is shown at the top right.
- **Needs a look:** jobs whose card showed no location. Click one to open it. The full details are captured, and the next import fills in the location.
- **Warning (orange `!` on the icon):** you were on a LinkedIn jobs page and no jobs were captured, which usually means LinkedIn changed its pages. Click **Save page for fixing** and the page is saved to `Downloads\web-job-scraper\debug\`, ready for updating the extension.

The number on the icon is how many new jobs were captured today.

## The fox and the garden

A pixel-art fox and its garden run along the whole bottom of LinkedIn's job pages, and across the top of the panel. They're there to make browsing less boring, so they change as you work but aren't something to manage.

- **Garden:** each foxglove is a job the extension has spotted in a list but not collected yet. Opening the job collects its details, and its flower disappears. Jobs LinkedIn says are closed disappear too. So the garden grows as jobs turn up and shrinks as you work through them. Each job keeps its own foxglove colour (magenta, pink, lilac, apricot, cream or deep rose). The newest is on the right, and up to 10 show (the newest jobs still to collect).
- **Bee:** every few minutes, while there are foxgloves, a bee flies in, visits one to three of them and buzzes off. The fox looks up when it arrives.
- **Fox:** when there's nothing left to collect, the fox's work is done and it sleeps. A new job wakes it with a stretch and a pounce, and a **+1** floats up. While there are flowers it walks, sits and naps now and then (more often late at night), and watches with its ears up while you scroll job lists.
- **Clicks:** clicks pass through the strip to the page. The fox is the only thing that reacts: click it to wake it or make it hop.
- **Settings (panel):** show it on LinkedIn or not, and its speed (calm, normal, playful).
- It pauses when the tab is hidden. With Windows' "reduce animations" setting on, it only sits and blinks.
- It's drawn entirely in the extension's own code (no image files) inside a sealed-off part of the page, so LinkedIn's styles can't break it. Turning it off removes it from the page completely.

Ideas for later: digging, sniffing flowers, stretching, the butterfly and the sunrise intro.

## What gets imported

Job Finder checks each job with the same rules as its own search, using your **profile's** job titles and cities (not your last search):

- The **title** must match one of your job titles. Closely related titles also count.
- The **location** must be in your cities' radius or your chosen states. Remote jobs pass unless they're limited to other states.
- **Internships**, **jobs closed to US applicants**, **blocked companies** and **jobs you rejected** are left out.
- **Jobs you already applied to** (LinkedIn shows "Applied" on them) are always added, whatever their title or location. They're marked **Saved** with status **Applied**. If the job is already in Job Finder, that row is updated instead. A status you set further along, such as Interview, is left alone.
- The location on a job's card, such as "Austin, TX", counts as proof that the job is in the US.
- **No location on the card:** the job is still added if the title matches, marked **Location unknown**. Once you open it, the next import checks its location. If the job is outside your area, it moves to Rejected Listings.
- **The same job on two sites** (or already found by Job Finder's own search) stays one row, showing **Also on: LinkedIn**.
- **Closed jobs:** when a job you open says it's no longer accepting applications, the import marks it Closed. Job Finder's **Refresh** doesn't re-check LinkedIn jobs, because LinkedIn answers it with a sign-in page, which would look like a closed job.

Jobs that aren't imported stay in the files, so nothing is lost.

## Where files live

```
Downloads\web-job-scraper\
  searches\passive-09-30-2026\linkedin\jobs.json   ← the extension saves here
  debug\linkedin-09-30-2026-14.05\                 ← "Save page for fixing"

web-job-scraper\searches\
  passive-09-30-2026\linkedin\jobs.json            ← moved here when you click Yes
  passive-09-30-2026\linkedin\jobs.csv             ← the same jobs, for a spreadsheet
  .imported.json                                   ← which files were already imported
```

`Downloads` above means Firefox's download folder. If Firefox saves downloads to the Desktop, the files are in `Desktop\web-job-scraper\`, and Job Finder looks there automatically. Folder names use month-day-year. To use different folders, add `capture_downloads_dir` or `capture_searches_dir` to Job Finder's `settings.json`.

## Cleanup

- **Capture folders** older than 30 days are deleted once they've been imported.
- **Closed jobs** are deleted from Job Finder 30 days after they closed, unless you saved them. Saved means you kept the job or marked it Saved, Applied or Interview.
- The extension keeps its own copy of captured jobs for 30 days.

## Privacy and limits

- Everything stays on your computer. The extension sends nothing anywhere and never reads passwords. Its only outside request is **Check for updates**, which reads `updates.json` from GitHub Pages.
- Captured jobs (`searches\`) and build output (`dist\`) are never uploaded; `.gitignore` keeps them out of the repository.
- LinkedIn's terms don't allow automated collection. Capture here is passive (it reads only what you open yourself), which keeps the risk low, but it isn't zero.
- LinkedIn changes its pages now and then, so expect the occasional fix. The orange warning tells you when one is needed.
- The extension reads the job data LinkedIn loads in the background, so it works with LinkedIn's AI job search, which is replacing classic search. It falls back to reading the page when that data can't be read.

## Error codes

**Extension** (shown in the toolbar panel, with an orange `!` on the icon):

| Code | Meaning | What to do |
|---|---|---|
| E7001 | Today's file couldn't be saved to Downloads. | Your jobs are kept. It tries again at the next save, or click **Save now**. Check that Downloads isn't full and that Firefox can save downloads without asking. |
| E7002 | You were on a LinkedIn jobs page but no jobs were captured. LinkedIn has probably changed its pages. | Click **Save page for fixing** and ask for the extension to be updated. |
| E7003 | **Save page for fixing** didn't work. | Open the LinkedIn jobs page that had the problem, then click the button again. |
| E7004 | **Check for updates** couldn't reach the project's GitHub Pages site. | Check your internet connection, then click the button again. |
| E7005 | A job was open, but its details (description, location) couldn't be read. LinkedIn's job pages have probably changed. | Nothing. The first time each day, a copy of the page is saved to `Downloads\web-job-scraper\debug\` by itself, ready for updating the extension. |

**Job Finder import** (shown in the message after an import, and in `job_finder.log`):

| Code | Meaning | What to do |
|---|---|---|
| E2120 | The dashboard couldn't read the Downloads capture folder. | Check that the folder exists and isn't open in another program. |
| E2121 | The capture files couldn't be moved, or the import couldn't start. | Close any program using the files, then click **Yes** again. |
| E6001 | The database couldn't be reached. | Start MySQL (XAMPP), or restart Job Finder with `start.ps1`. |
| E6002 | The database couldn't be updated for the import. | See `job_finder.log` for the database's message. |
| E6003 | Your profile has no job titles, so nothing can be matched. | Add job titles to your profile, then import again. |
| E6004 | A job couldn't be saved. | Its file isn't marked as imported, so the next import tries it again. |
| E6005 | A capture file couldn't be read (damaged or half-written). | It's skipped. If it keeps happening, open the file to check it. |
| E6006 | Imported files couldn't be recorded, or old folders couldn't be removed. | Close any program using `web-job-scraper\searches`. |
| E6007 | Closed jobs couldn't be tidied. | Nothing is lost; it tries again next time. |
| E6008 | Your profile couldn't be read. | See `job_finder.log` for the database's message. |

## Tests

- Extension reader: `npm install` once, then `npm test`.
- Job Finder import: `python -m unittest tests.test_capture_import` in the `job-finder` folder.

## Planned later

These are carried over from the original plan.

**Next step: opening matching jobs automatically.** The extension would open jobs from **Needs a look** by itself to capture their details, with strict limits:
- only jobs whose title matches
- only while you're actively on that site
- one job every few random minutes
- about 10 a day per site
- stop for the day at any CAPTCHA, "verify it's you" or unusual-activity notice

**Indeed and Glassdoor capture**, in the same way as LinkedIn.

**Daily scheduled search:**
- Once a day, at a random time between 6:00 and 6:20 AM, the extension opens page 1 of LinkedIn's "Jobs based on your preferences" and "Jobs that match your profile".
- It merges the two lists, opens only jobs not already saved (about 50 at most per run), and records which list each came from. If a section can't be found, it's skipped and logged rather than guessed.
- A **Start search** button counts as that day's run. Runs need Firefox open and the computer awake. A run missed while asleep happens after waking, on the same day only.
- Each run gets its own folder, `searches\mm-dd-yyyy-HH.MM\`, with a `run-log.txt` recording login status, counts and warnings. A second run in the same minute gets a `-2` folder.
- The panel gets **Start search** and **Stop** buttons, live progress (for example "LinkedIn: 23 / 50 opened, 4 new"), login status with a **Log in** button, and each site's daily limit and today's count.

**Guardrails for anything automatic:**
- a human pace, with random pauses
- per-site daily limits that start low and rise slowly after a week with no warnings
- filtering on card data before opening anything, and never reopening saved jobs
- stopping at once on a CAPTCHA, a "verify it's you" check, an unusual-activity notice, a slowdown or a sign-in wall, then halving that site's limit and showing a red badge
- never trying to get past those checks, and running only in your normal browser profile

**Login and warning badges:** a yellow `!` when a site needs you to log in (that site is skipped and the others continue), and a red `!` when a site showed a warning.

**Open questions for then:**
- What should the Indeed and Glassdoor scheduled runs collect?
- Should filters such as minimum pay be added?
- Should extra fields be captured (easy-apply, applicant count)?
- Should Firefox open automatically at startup?
