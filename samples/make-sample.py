# Builds samples/sample-exam.docx: a short exam written the way the admin site reads it.
# Run: python3 samples/make-sample.py samples/sample-exam.docx
import os, sys, zipfile
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'
def esc(t): return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
def p(text, bold=False):
    rpr = '<w:rPr><w:b/></w:rPr>' if bold else ''
    return f'<w:p><w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'
lines = [
    ('MIDTERM EXAMINATION (sample)', True), ('', False),
    ('Part I. Multiple choice', True),
    ('1. Which planet is closest to the Sun?', False), ('A. Venus', False), ('B. Mercury', False), ('C. Earth', False), ('D. Mars', False),
    ('Answer: B', False), ('', False),
    ('Part II. Identification', True),
    ('1. The powerhouse of the cell.', False), ('Answer: mitochondria | mitochondrion', False), ('', False),
    ('Part III. Problem solving', True),
    ('1. A ball is thrown straight up at 20 m/s. Use g = 9.8 m/s².', False),
    ('a) Find the maximum height, in m. (3 pts)', False), ('Answer: 20.4', False),
    ('b) Find the time to reach the top, in s. (2 pts)', False), ('Answer: 2.04', False),
    ('Solution: At the top v = 0, so h = v0²/(2g) = 400/19.6 = 20.4 m and t = v0/g = 20/9.8 = 2.04 s.', False), ('', False),
    ('2. Two dice are rolled. (4 points)', False),
    ('a) How many outcomes are possible?', False),
    ('b) What is the probability that the sum is 7?', False),
    ('Answer: 1/6', False),
    ('Solution: There are 6 × 6 = 36 outcomes; 6 of them have a sum of 7, so P = 6/36 = 1/6.', False), ('', False),
    ('Part IV. Essay', True),
    ('1. Explain why the sky is blue. (10 points)', False),
    ('Guide: mentions that air scatters short (blue) wavelengths more than long ones.', False),
]
body = ''.join(p(t, b) for t, b in lines)
doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}</w:body></w:document>'
types = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
         '<Default Extension="xml" ContentType="application/xml"/>'
         '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
rels = ('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
out = sys.argv[1]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', types); z.writestr('_rels/.rels', rels); z.writestr('word/document.xml', doc)
print(out)
