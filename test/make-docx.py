# Builds test/fixture.docx the way Word saves one: automatic list numbering (1. 2. / A. B.), a Word equation and a
# picture. Used by run.js to check the admin site's Word reader. Run: python3 test/make-docx.py
import io, os, zipfile
from PIL import Image

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"'

def p(text, num=None, lvl=0):
    ppr = f'<w:pPr><w:numPr><w:ilvl w:val="{lvl}"/><w:numId w:val="{num}"/></w:numPr></w:pPr>' if num else ''
    return f'<w:p>{ppr}<w:r><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'

eq = ('<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>'
      '<w:r><w:t xml:space="preserve">Simplify </w:t></w:r>'
      '<m:oMath><m:f><m:num><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:num>'
      '<m:den><m:r><m:t>x</m:t></m:r></m:den></m:f></m:oMath><w:r><w:t>.</w:t></w:r></w:p>')
# a real picture (word/media/image1.png, relationship rId5) and a Word drawing with no picture file (cannot be imported)
pic = ('<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
       '<a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill>'
       '<a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId5"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>')
shape = '<w:p><w:r><w:drawing/></w:r></w:p>'
body = ''.join([
    p('Part I. Multiple choice'),
    p('Which planet is closest to the Sun?', 1, 0),
    p('Venus', 1, 1), p('Mercury', 1, 1), p('Earth', 1, 1), p('Mars', 1, 1),
    p('Answer: B'),
    eq,
    pic,
    p('x', 1, 1), p('2x', 1, 1), p('x²', 1, 1), p('1', 1, 1),
    p('Answer: A'),
    shape,
    p('Part II. Problem solving'),
    p('A car travels 120 km in 2 hours. What is its average speed in km/h?', 2, 0),
    p('Answer: 60'),
    p('Solution: speed = distance / time = 120 / 2 = 60 km/h'),
])
doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}</w:body></w:document>'
lvl = lambda i, fmt, text: f'<w:lvl w:ilvl="{i}"><w:start w:val="1"/><w:numFmt w:val="{fmt}"/><w:lvlText w:val="{text}"/></w:lvl>'
numbering = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {W}>'
             f'<w:abstractNum w:abstractNumId="0">{lvl(0, "decimal", "%1.")}{lvl(1, "upperLetter", "%2.")}</w:abstractNum>'
             f'<w:abstractNum w:abstractNumId="1">{lvl(0, "decimal", "%1.")}</w:abstractNum>'
             '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
             '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>')
types = ('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
         '<Default Extension="xml" ContentType="application/xml"/></Types>')
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixture.docx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', types)
    z.writestr('word/document.xml', doc)
    z.writestr('word/numbering.xml', numbering)
    z.writestr('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>')
    png = io.BytesIO(); Image.new('RGB', (60, 40), (200, 30, 60)).save(png, 'PNG')
    z.writestr('word/media/image1.png', png.getvalue())
    with open(os.path.join(os.path.dirname(out), 'fixture.png'), 'wb') as f: f.write(png.getvalue())
print(out)
