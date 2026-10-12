import { describe, it, expect } from "vitest";
import { unzipSync } from "fflate";
import { createZip } from "../../src/core/zip-writer";

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (u: Uint8Array) => new TextDecoder().decode(u);

describe("createZip", () => {
  it("produces a zip fflate can read back", () => {
    const zip = createZip([
      { path: "mimetype", data: enc("application/epub+zip") },
      { path: "OEBPS/a.txt", data: enc("hello") },
    ]);
    const files = unzipSync(zip);
    expect(dec(files["mimetype"])).toBe("application/epub+zip");
    expect(dec(files["OEBPS/a.txt"])).toBe("hello");
  });

  it("writes the first entry (mimetype) at offset 0, stored, name at byte 30", () => {
    const zip = createZip([{ path: "mimetype", data: enc("application/epub+zip") }]);
    // local file header signature
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    // compression method (offset 8) == 0 (store)
    expect(zip[8]).toBe(0);
    expect(zip[9]).toBe(0);
    // filename begins at byte 30
    expect(dec(zip.slice(30, 38))).toBe("mimetype");
  });

  it("round-trips binary data unchanged", () => {
    const bin = new Uint8Array([0, 1, 2, 255, 254, 128]);
    const files = unzipSync(createZip([{ path: "b.bin", data: bin }]));
    expect(Array.from(files["b.bin"])).toEqual(Array.from(bin));
  });

  // fflate prueft den CRC beim Entpacken nicht — der Round-Trip oben erkennt einen falschen
  // CRC-32 also nicht. Pruefwert: CRC-32 von "123456789" ist 0xCBF43926 (IEEE 802.3).
  it("writes the CRC-32 into local header and central directory", () => {
    const name = "check.txt";
    const data = enc("123456789");
    const zip = createZip([{ path: name, data }]);
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    // local header: CRC at offset 14
    expect(view.getUint32(14, true)).toBe(0xcbf43926);
    // central directory follows the single entry's header + data; CRC at offset 16 in it
    const central = 30 + name.length + data.length;
    expect(view.getUint32(central, true)).toBe(0x02014b50);
    expect(view.getUint32(central + 16, true)).toBe(0xcbf43926);
  });

  it("writes the CRC-32 of an empty entry as 0", () => {
    const zip = createZip([{ path: "e", data: new Uint8Array(0) }]);
    expect(new DataView(zip.buffer).getUint32(14, true)).toBe(0);
  });
});
