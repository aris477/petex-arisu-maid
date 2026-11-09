# -*- coding: utf-8 -*-
import hashlib, json, shutil, struct
from pathlib import Path

portable = Path(r"D:\codex_file\2026-11-08\new-chat-2\outputs\Petex-Portable")
run_dir = Path(r"D:\codex_file\2026-11-08\new-chat-2\work\arisu-maid-run")
asar_path = portable / "resources" / "app.asar"
exe_path = portable / "Petex.exe"
asar_bak = portable / "resources" / "app.asar.bak"
exe_bak = portable / "Petex.exe.bak"

if not asar_bak.exists():
    shutil.copy2(asar_path, asar_bak)
if not exe_bak.exists():
    shutil.copy2(exe_path, exe_bak)

raw = bytearray(asar_bak.read_bytes())
u0, u1, u2, u3 = struct.unpack("<IIII", raw[:16])
old_hdr_bytes = bytes(raw[16:16+u3])
old_hdr_sha = hashlib.sha256(old_hdr_bytes).hexdigest().encode("ascii")
hdr = json.loads(old_hdr_bytes.decode("utf-8"))
data_start = 16 + u2

def get_file_span(entry):
    off = data_start + int(entry["offset"])
    sz = int(entry["size"])
    return off, sz, bytes(raw[off:off+sz])

# 1. Patch app/renderer/sprite.js keeping EXACT byte length
sp_entry = hdr["files"]["app"]["files"]["renderer"]["files"]["sprite.js"]
sp_off, sp_sz, sp_bytes = get_file_span(sp_entry)
sp_txt = sp_bytes.decode("utf-8")

old_draw = "else if(this.image)ctx.drawImage(this.image,pose.frame*192,pose.row*208,192,208,0,0,192,208);"
new_draw = "else if(this.image){const s=this.image.width>>11?2:1;ctx.drawImage(this.image,pose.frame*192*s,pose.row*208*s,192*s,208*s,0,0,192,208);}"
assert old_draw in sp_txt, "old_draw not found in sprite.js"
diff_sp = len(new_draw) - len(old_draw)
# Shorten a comment in sprite.js by exact diff_sp bytes!
old_comment = "// Original vector companion. It is independent of the imported Codex artwork."
assert len(old_comment) - 3 >= diff_sp, f"comment too short for {diff_sp}"
new_comment = old_comment[:len(old_comment) - diff_sp]
sp_new_txt = sp_txt.replace(old_draw, new_draw, 1).replace(old_comment, new_comment, 1)
sp_new_bytes = sp_new_txt.encode("utf-8")
assert len(sp_new_bytes) == sp_sz, f"sprite.js size mismatch: {len(sp_new_bytes)} vs {sp_sz}"
raw[sp_off:sp_off+sp_sz] = sp_new_bytes
sp_sha = hashlib.sha256(sp_new_bytes).hexdigest()
sp_entry["integrity"]["hash"] = sp_sha
sp_entry["integrity"]["blocks"] = [sp_sha]

# 2. Patch app/library.cjs keeping EXACT byte length so validateSprite accepts both 1536x(rows*208) and 3072x(rows*416)
lib_entry = hdr["files"]["app"]["files"]["library.cjs"]
lib_off, lib_sz, lib_bytes = get_file_span(lib_entry)
lib_txt = lib_bytes.decode("utf-8")

old_val = """  try { size = await sharp(bytes, {limitInputPixels: 1536 * 2288}).metadata(); } catch { throw new Error('The sprite sheet is not a readable PNG or WebP image.'); }
  if (!['png', 'webp'].includes(size.format)) throw new Error('Use a PNG or WebP sprite sheet.');
  const rows = version === 2 ? 11 : 9;
  if (size.width !== 1536 || size.height !== rows * 208) throw new Error(`This pet needs a 1536 × ${rows * 208} sprite sheet (8 × ${rows} frames).`);
  if ((size.pages || 1) > 1) throw new Error('Use a static sprite atlas, not an animated image.');
  try { await sharp(bytes, {limitInputPixels: 1536 * 2288}).raw().toBuffer(); } catch { throw new Error('The sprite sheet is damaged and could not be decoded.'); }"""

# Normalize CRLF vs LF
if "\r\n" in lib_txt and "\r\n" not in old_val:
    old_val = old_val.replace("\n", "\r\n")

new_val = """  try { size = await sharp(bytes, {limitInputPixels: 3072 * 4576}).metadata(); } catch { throw new Error('The sprite sheet is not a readable PNG or WebP image.'); }
  if (!['png', 'webp'].includes(size.format)) throw new Error('Use a PNG or WebP sprite sheet.');
  const rows = version === 2 ? 11 : 9, sc = size.width === 3072 ? 2 : 1;
  if (size.width !== 1536 * sc || size.height !== rows * 208 * sc) throw new Error(`Need 1536x${rows * 208} atlas.`);
  if ((size.pages || 1) > 1) throw new Error('Use a static sprite atlas, not an animated image.');
  try { await sharp(bytes, {limitInputPixels: 3072 * 4576}).raw().toBuffer(); } catch { throw new Error('The sprite sheet is damaged and could not be decoded.'); }"""

if "\r\n" in lib_txt and "\r\n" not in new_val:
    new_val = new_val.replace("\n", "\r\n")

assert old_val in lib_txt, "old_val not found in library.cjs"
diff_lib = len(new_val.encode("utf-8")) - len(old_val.encode("utf-8"))
old_lib_comment = "/* A damaged entry must not prevent the rest of the library from loading. */"
assert old_lib_comment in lib_txt
# Adjust comment length by -diff_lib
target_comment_len = len(old_lib_comment) - diff_lib
inner_len = target_comment_len - 4
new_lib_comment = "/*" + ("*" * inner_len) + "*/"
lib_new_txt = lib_txt.replace(old_val, new_val, 1).replace(old_lib_comment, new_lib_comment, 1)
lib_new_bytes = lib_new_txt.encode("utf-8")
assert len(lib_new_bytes) == lib_sz, f"library.cjs size mismatch: {len(lib_new_bytes)} vs {lib_sz}"
raw[lib_off:lib_off+lib_sz] = lib_new_bytes
lib_sha = hashlib.sha256(lib_new_bytes).hexdigest()
lib_entry["integrity"]["hash"] = lib_sha
lib_entry["integrity"]["blocks"] = [lib_sha]

# Serialize header JSON with exact compact formatting as original
new_hdr_bytes = json.dumps(hdr, separators=(",", ":")).encode("utf-8")
assert len(new_hdr_bytes) == u3, f"Header len mismatch: {len(new_hdr_bytes)} vs {u3}"
raw[16:16+u3] = new_hdr_bytes
new_hdr_sha = hashlib.sha256(new_hdr_bytes).hexdigest().encode("ascii")

asar_path.write_bytes(bytes(raw))

# Update the 64-byte ASCII ASAR header hash in Petex.exe
exe_bytes = exe_bak.read_bytes()
assert old_hdr_sha in exe_bytes, "old_hdr_sha not found in Petex.exe.bak"
exe_new = exe_bytes.replace(old_hdr_sha, new_hdr_sha)
exe_path.write_bytes(exe_new)
print("Patched Petex.exe + app.asar for Native 2x HD (3072x4576)! New hdr sha:", new_hdr_sha.decode())

# Now install the 2x HD (3072x4576) spritesheet.webp into Petex-Portable/data/pets/<uuid>/
hd_webp = run_dir / "final" / "spritesheet-extended-2x-hd.webp"
hd_bytes = hd_webp.read_bytes()
hd_fp = hashlib.sha256(hd_bytes).hexdigest()

pets_dir = portable / "data" / "pets"
for pdir in pets_dir.iterdir():
    if pdir.is_dir():
        shutil.copy2(hd_webp, pdir / "spritesheet.webp")
        pj = json.loads((pdir / "pet.json").read_text(encoding="utf-8"))
        pj["fingerprint"] = hd_fp
        (pdir / "pet.json").write_text(json.dumps(pj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Updated Petex pet folder with 2x HD (3072x4576) spritesheet.webp:", pdir.name, len(hd_bytes), "bytes")
