# RTU Online Exams

Online exams for all subjects (PHYMECH, CAL00, CAL01, CAL02, MMW, …) with tab-switch detection, run as one Google Apps
Script web app open only to **@rtu.edu.ph** accounts.

- **Student link:** https://mrvitalez.github.io/Online-Exam/ forwards students to the web app. Students are recognised
  by their Google account (`<student number>@rtu.edu.ph`) and see only the exams of the subjects and block sections
  they are enrolled in.
- **Admin site:** the web app link followed by `?page=admin`. Only the accounts in `CONFIG.ADMIN_EMAILS` (in `Code.gs`)
  can open it.

## What the admin site does

| Tab | What you do there |
|---|---|
| 📋 Overview | See what is open now and how many students are taking an exam |
| 📝 Exams | Create an exam per subject. **Paste** multiple-choice, identification, problem-solving and essay questions with their answers and solutions, or **choose a Word (.docx), PDF or text file** and it is read in for you (Word keeps its automatic numbering and equations; from a PDF, math comes out as plain text); check the preview, then save. Set the opening and closing times, time limit, block sections, auto-submit rule, shuffling, and when solutions are shown. |
| 📊 Results | Every enrolled student's status, score, tab-switch count and time away (updates every 20 s). Open a student to see each answer, their written solutions and essays, and the activity log. **Score essays** and change the points of any question (for example, to accept a misspelled answer). Give a final score and remarks, allow a retake, re-grade after fixing a key, download CSV. |
| 🧑‍🎓 Class list | Paste your **record book** link, choose the tabs, import. Tab `MMW - CEIT-03-101E` gives subject MMW and that block section; a tab like `CAL00` gives the subject, and its `YEAR AND SECTION:` cell gives the block section. Student numbers in column A, the name in the next filled cell. Tick **Blocked** to stop a student. **Remove** one student, or filter (for example by subject) and remove everyone shown; **Add a student** by hand. |
| ⚙️ Settings | The web app address, site title, instructor name |

### Pasting questions

```
1. Which planet is closest to the Sun?
A. Venus
B. Mercury
C. Earth
D. Mars
Answer: B

2. A ball is thrown straight up at 20 m/s. How high does it rise? (g = 9.8 m/s²)
Answer: 20.4
Points: 5
Tolerance: 2%
Solution:
At the top v = 0, so $h = \frac{v_0^2}{2g} = \frac{20^2}{2(9.8)} = 20.4$ m.
```

- Four question types:
  - **Multiple choice:** choices A–H and a letter answer.
  - **Identification:** the student types a word or phrase; checked automatically against the accepted answers
    (capitals, accents, extra spaces and punctuation are ignored; several answers separated by `|`).
  - **Problem solving:** the student types a final answer (checked automatically: a number within the tolerance, an
    exact value like `3/8` or `pi/4`, or a formula like `x^2 + C`; units are ignored) and writes a solution with a math
    toolbar.
  - **Essay:** the student writes a long answer; you give the points in Results. An optional `Rubric:` / `Guide:` is
    shown to students with the solutions.
- The type comes from headings such as `Part II. Identification`, `ESSAY` or `Part IV. Problem solving`, or a
  `Type: essay` line under a question. Without one, it is guessed: choices → multiple choice; a numeric or formula
  answer or a solution → problem solving; a word answer → identification; no answer → essay. Check the preview.
- Points written in a question, like `(5 points)` or `[2 pts]`, are used for that question.
- Also understood: choices on one line (`A. 2x  B. x²  C. 2`), the correct choice marked with `*`, an **Answer key**
  section at the end (`1. B  2. C  3. A`), a **Solutions** section at the end, and `Part I` / `Part II` headings where
  numbering starts again. Several accepted answers: `Answer: 0.5 | 1/2`.
- Number the steps of a solution as `Step 1` or `(1)`, not `1.`, so they are not read as new questions.
- Math is LaTeX between `$ … $` and is shown rendered to students.
- From a file: Word (.docx), PDF or plain text. Word works best: equations become math. From a PDF, the text is read
  column by column (two- and three-column layouts), choice grids are put in A–D order, and powers and subscripts are
  kept (x², H₂O); stacked fractions and other built-up math come out as plain text, so check the preview. A scanned PDF
  (a picture of the page) has no text to read. From Google Docs, use **File > Download > Microsoft Word (.docx)**.
  Pictures are not imported. Files are read in your browser and are not uploaded anywhere.

### Tab-switch detection
Switching tabs, minimising, clicking into another window or app, leaving fullscreen (when the browser allows
fullscreen inside Google's frame), and copy/paste/right-click attempts are recorded with times. After the number of
departures you set, the exam is submitted automatically. The timer keeps running if a student closes the page, and
unfinished exams are submitted when time runs out. Detection cannot see a phone or another device.

## Setup or upgrade (about 10 minutes)

Do this while signed in to your **@rtu.edu.ph** account. If your email is not `rmvitalez@rtu.edu.ph`, change
`CONFIG.ADMIN_EMAILS` at the top of `Code.gs` first.

**Upgrading the first version (keeps your exam link):** open the same Google Sheet, then **Extensions > Apps Script**.
**New project:** create a Google Sheet, then **Extensions > Apps Script**.

1. Make these files in the Apps Script editor and paste the contents of the files in `apps-script/` (names must match):
   - `Code.gs`, plus a new script file `MathExpr` (**+ > Script**)
   - HTML files `Student`, `Admin` and `Styles` (**+ > HTML**)
   - When upgrading, delete the old `Index` file.
2. Click **Save**. Choose **setup** in the function list, then click **Run**. Allow the permissions it asks for, including
   opening other spreadsheets (to read your record book). When upgrading, the old tabs are kept as
   "Settings (old version)" and "Questions (old version)"; you can delete them, and the old Sections, Students, Results
   and Log tabs, once you no longer need them.
3. **Deploy:**
   - Upgrading: **Deploy > Manage deployments > ✏️ > Version: New version > Deploy**. The link does not change.
   - New project: **Deploy > New deployment > ⚙️ Web app**, Execute as **Me**, Who has access **Anyone within Rizal
     Technological University**, then **Deploy**. Put the new link in `index.html` (three places).
4. Open the web app link with `?page=admin` at the end. In **Settings**, paste the web app link (ending in `/exec`).
5. **Class list:** paste your record book link, click **Read tabs**, check the subjects and block sections, then
   **Import**.
6. **Exams:** create an exam, paste the questions, set the times, choose **Published**, then **Save exam**. Try it
   yourself first: as the instructor you can open every exam, including drafts, from the student link.

After you change the code later, deploy a **New version** again (step 3). Changes made in the admin site apply right
away and need no deployment.

## Files

```
index.html                GitHub Pages page that forwards students to the web app
apps-script/Code.gs       Server code: exams, attempts, grading, class list import, admin functions
apps-script/MathExpr.gs   Reads and compares math answers (same as in the online modules)
apps-script/Student.html  Student site: exam list, exam with tab-switch detection, review
apps-script/Admin.html    Admin site
apps-script/Styles.html   Maroon and Gold styles (shared with the online modules)
img/                      Icons and the university seal
test/                     Local test kit (fake Google services + browser test); not part of the deployment.
                          For the PDF test, put pdf.min.js and pdf.worker.min.js from pdfjs-dist@3.11.174 in test/vendor/
```

All data lives in the Google Sheet: **Exams**, **Questions** (answer keys and solutions), **Class List**, **Attempts**
(one row per student per exam, with answers and the activity log) and **Settings**. Answer keys are never in this
repository.
