"""Place final imagegen artwork on A4 landscape PDFs without changing the images."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from PIL import Image
from pypdf import PdfReader
import subprocess
import shutil
root = Path(__file__).resolve().parent.parent
source = root / 'docs/exhibition-media/2026-09-23'
out = root / 'output/pdf'
out.mkdir(parents=True, exist_ok=True)
w, h = landscape(A4)
for name in ['airplanevoice-concept-a4-landscape', 'airplanevoice-away-a4-landscape']:
    image = source / (name + '.png')
    iw, ih = Image.open(image).size
    scale = min((w-12*mm)/iw, (h-12*mm)/ih)
    target = out / (name + '.pdf')
    c = canvas.Canvas(str(target), pagesize=(w,h))
    c.setTitle('AIRPLANEVOICE - ' + ('Concept' if 'concept' in name else 'Away'))
    c.setAuthor('AIRPLANEVOICE')
    c.drawImage(str(image), (w-iw*scale)/2, (h-ih*scale)/2, iw*scale, ih*scale)
    c.showPage()
    c.save()
    doc = PdfReader(target)
    box = doc.pages[0].mediabox
    assert len(doc.pages) == 1 and abs(float(box.width)-w) < .1 and box.width > box.height
    subprocess.run([shutil.which('pdftoppm'),'-png','-singlefile','-r','110',str(target),str(out / (name+'-preview'))], check=True, creationflags=subprocess.CREATE_NO_WINDOW)
    print(f'{target}: A4 landscape, 1 page, artwork {iw}x{ih}')
