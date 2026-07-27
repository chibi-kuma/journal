/* Lecture / écriture d'archives ZIP (entrées non compressées).
   Les photos sont déjà compressées (JPEG), le ZIP sert de simple conteneur. */
'use strict';

const Zip = (() => {

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(data) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  /* files : [{ name: string, data: Uint8Array }] → Uint8Array (archive ZIP) */
  function create(files) {
    const encoder = new TextEncoder();
    const now = dosDateTime(new Date());
    const entries = files.map(f => ({
      nameBytes: encoder.encode(f.name),
      data: f.data,
      crc: crc32(f.data),
      offset: 0
    }));

    let localSize = 0;
    for (const e of entries) localSize += 30 + e.nameBytes.length + e.data.length;
    let centralSize = 0;
    for (const e of entries) centralSize += 46 + e.nameBytes.length;
    const out = new Uint8Array(localSize + centralSize + 22);
    const view = new DataView(out.buffer);
    let pos = 0;

    for (const e of entries) {
      e.offset = pos;
      view.setUint32(pos, 0x04034B50, true);        // signature d'entrée locale
      view.setUint16(pos + 4, 20, true);            // version requise
      view.setUint16(pos + 6, 0x0800, true);        // noms en UTF-8
      view.setUint16(pos + 8, 0, true);             // méthode : stockage
      view.setUint16(pos + 10, now.time, true);
      view.setUint16(pos + 12, now.day, true);
      view.setUint32(pos + 14, e.crc, true);
      view.setUint32(pos + 18, e.data.length, true);
      view.setUint32(pos + 22, e.data.length, true);
      view.setUint16(pos + 26, e.nameBytes.length, true);
      view.setUint16(pos + 28, 0, true);            // extra
      pos += 30;
      out.set(e.nameBytes, pos); pos += e.nameBytes.length;
      out.set(e.data, pos); pos += e.data.length;
    }

    const centralStart = pos;
    for (const e of entries) {
      view.setUint32(pos, 0x02014B50, true);        // signature centrale
      view.setUint16(pos + 4, 20, true);            // créé par
      view.setUint16(pos + 6, 20, true);            // version requise
      view.setUint16(pos + 8, 0x0800, true);
      view.setUint16(pos + 10, 0, true);
      view.setUint16(pos + 12, now.time, true);
      view.setUint16(pos + 14, now.day, true);
      view.setUint32(pos + 16, e.crc, true);
      view.setUint32(pos + 20, e.data.length, true);
      view.setUint32(pos + 24, e.data.length, true);
      view.setUint16(pos + 28, e.nameBytes.length, true);
      // champs extra/commentaire/disque/attributs : zéro
      view.setUint32(pos + 42, e.offset, true);
      pos += 46;
      out.set(e.nameBytes, pos); pos += e.nameBytes.length;
    }

    view.setUint32(pos, 0x06054B50, true);          // fin de répertoire central
    view.setUint16(pos + 8, entries.length, true);
    view.setUint16(pos + 10, entries.length, true);
    view.setUint32(pos + 12, pos - centralStart, true);
    view.setUint32(pos + 16, centralStart, true);
    return out;
  }

  /* buffer : ArrayBuffer → Promise<Map<nom, Uint8Array>> */
  async function read(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder();

    // Recherche de la fin du répertoire central depuis la fin du fichier
    let eocd = -1;
    const minPos = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= minPos; i--) {
      if (view.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Fichier ZIP invalide');

    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const files = new Map();

    for (let n = 0; n < count; n++) {
      if (view.getUint32(pos, true) !== 0x02014B50) throw new Error('Fichier ZIP invalide');
      const method = view.getUint16(pos + 10, true);
      const csize = view.getUint32(pos + 20, true);
      const nameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const offset = view.getUint32(pos + 42, true);
      const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
      pos += 46 + nameLen + extraLen + commentLen;

      // Position des données : après l'en-tête local (dont les longueurs peuvent différer)
      const localNameLen = view.getUint16(offset + 26, true);
      const localExtraLen = view.getUint16(offset + 28, true);
      const dataStart = offset + 30 + localNameLen + localExtraLen;
      const raw = bytes.slice(dataStart, dataStart + csize);

      if (method === 0) {
        files.set(name, raw);
      } else if (method === 8 && typeof DecompressionStream !== 'undefined') {
        const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const data = new Uint8Array(await new Response(stream).arrayBuffer());
        files.set(name, data);
      } else {
        throw new Error('Format de compression non pris en charge');
      }
    }
    return files;
  }

  return { create, read };
})();
