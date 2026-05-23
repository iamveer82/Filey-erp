# Filey heavy-tool worker.
# Bundles LibreOffice (Office<->PDF), OCRmyPDF + Tesseract (OCR / PDF/A),
# and Ghostscript (compression / PDF/A) alongside Node.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      libreoffice \
      ghostscript \
      ocrmypdf \
      tesseract-ocr \
      fonts-liberation \
      fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

# Long-running worker; no port needed (it polls Supabase).
CMD ["node", "index.js"]
