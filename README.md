# Online exam with tab-switch detection (Google Apps Script)

Students open one link and are identified by their Google account. Only **@rtu.edu.ph** accounts on your student list, in an open block section, can take the exam. You control everything from a Google Sheet.

## Important: use your @rtu.edu.ph account
Do every step below while signed in to your **@rtu.edu.ph** Google account. This is required for two reasons:
- the "Anyone within Rizal Technological University" access option only exists for school accounts;
- Google only tells the script who the student is when the script's owner and the student are in the same school domain.

If you set this up with a personal Gmail account, the email check cannot work.

## Setup (about 10 minutes, one time)
1. Create a new Google Sheet, for example "Science Exam".
2. Open **Extensions > Apps Script**.
3. In `Code.gs`, delete what's there and paste the contents of **Code.gs** from this folder.
4. Click **+** next to Files, choose **HTML**, and name it `Index` (exactly). Paste the contents of **Index.html**. Click **Save**.
5. In the toolbar's function menu, pick **setup**, then click **Run**. Google asks for permission: choose **Review permissions**, pick your RTU account, then click **Allow**.
6. Go back to the Sheet. It now has Settings, Questions, Sections, Students, Results and Log tabs with examples, plus an **Exam** menu.
7. In Apps Script, click **Deploy > New deployment**, click the gear icon, choose **Web app**, and set:
   - Execute as: **Me**
   - Who has access: **Anyone within Rizal Technological University**

   Click **Deploy** and copy the web app URL. This is the link you give students. You can also find it later under **Exam > Show the exam link**.
8. Do a test run: add your own email and a classmate's or co-teacher's to **Students** in an open section, and try the exam.

## Day-to-day use (no code needed)
| To change… | Edit this sheet |
|---|---|
| Title, time limit, auto-submit rule, copy/paste blocking, shuffling, showing scores | **Settings** (column B) |
| The questions | **Questions**: Type, Question, Points, Correct answer (a letter A–F, or accepted short answers separated by `\|`), Choices A–F |
| Block sections, and opening or closing the exam per section | **Sections** (tick **Open**) |
| Who can take the exam | **Students**: Email, Full name, Section; tick **Blocked** to stop a student |

- Changes apply right away, and you don't need to redeploy.
- **Results** and **Log** update about once a minute. Use **Exam > Update results now** to update immediately.
- **Exam > Allow retake for selected students** lets a student start over. Select their rows in Results or Students first.
- **Exam > Archive and clear all results** goes between exams. It keeps a copy of the results, then resets everyone.
- Fixing a wrong answer key re-grades everyone at the next results update.
- Don't edit or delete the **ID** column in Questions.

## If you change Code.gs or Index.html later
Go to **Deploy > Manage deployments**, click the pencil icon, set Version to **New version**, then click **Deploy**. The link stays the same.

## Tips for students
- Use a computer with Chrome and stay signed in to only the RTU account. A private/incognito window with just the RTU account avoids Google's "multiple accounts" errors.
- Answers save automatically every 20 seconds and whenever the student leaves the page.

## Limits to know
- Detection records that a student left the exam page (another tab, window or app). It cannot see what they looked at, or a phone or other device.
- Fullscreen probably won't work inside Google's frame. The exam carries on without it.
- Before the first real exam, run a trial with a full class at the same time to be sure everything holds up.

## `test/` folder
This is a local test kit used during development. Don't paste it into Apps Script.
