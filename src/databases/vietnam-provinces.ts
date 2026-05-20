/**
 * Vietnam's 34 administrative units after the 2025 merger (Nghị quyết 60-NQ/TW).
 *
 * Single source of truth for:
 *   - The canonical list of allowed province/city names.
 *   - Mapping of old (pre-2025) provinces to their new home.
 *   - District/ward keyword hints used when an address string contains
 *     no province name at all (e.g. "Cầu Giấy" → "Hà Nội").
 *
 * Use `resolveProvince(raw)` to normalize any free-form address string.
 */

/** 6 cities + 28 provinces. Display names use the "short" form
 *  ("Hà Nội", "TP. Hồ Chí Minh") — matches what the FE filter sidebar already
 *  ships and is consistent with the bulk of existing data. */
export const VN_PROVINCES_34 = [
  // 6 thành phố trực thuộc TW
  'Hà Nội',
  'TP. Hồ Chí Minh',
  'Hải Phòng',
  'Đà Nẵng',
  'Cần Thơ',
  'Huế',
  // 28 tỉnh
  'Lai Châu',
  'Điện Biên',
  'Sơn La',
  'Lạng Sơn',
  'Cao Bằng',
  'Tuyên Quang',
  'Lào Cai',
  'Thái Nguyên',
  'Phú Thọ',
  'Bắc Ninh',
  'Hưng Yên',
  'Ninh Bình',
  'Quảng Ninh',
  'Thanh Hóa',
  'Nghệ An',
  'Hà Tĩnh',
  'Quảng Trị',
  'Quảng Ngãi',
  'Gia Lai',
  'Khánh Hòa',
  'Lâm Đồng',
  'Đắk Lắk',
  'Đồng Nai',
  'Tây Ninh',
  'Vĩnh Long',
  'Đồng Tháp',
  'Cà Mau',
  'An Giang',
] as const;

export type VNProvince = (typeof VN_PROVINCES_34)[number];

export const VN_PROVINCE_SET: ReadonlySet<string> = new Set(VN_PROVINCES_34);

/**
 * Old province name → new province name (post-2025 merger).
 * Keys are stored in already-normalized form (lowercased, diacritics stripped)
 * so callers don't need to re-normalize. Use `normalizeForMatch()` on input
 * before lookup.
 */
export const OLD_TO_NEW_PROVINCE: Record<string, VNProvince> = {
  // → Hà Nội (Hà Tây sáp nhập từ 2008, vẫn còn xuất hiện trong dữ liệu cũ)
  'ha tay': 'Hà Nội',

  // → TP. Hồ Chí Minh
  'binh duong': 'TP. Hồ Chí Minh',
  'ba ria - vung tau': 'TP. Hồ Chí Minh',
  'ba ria vung tau': 'TP. Hồ Chí Minh',
  'ba ria': 'TP. Hồ Chí Minh',
  'vung tau': 'TP. Hồ Chí Minh',

  // → Hải Phòng
  'hai duong': 'Hải Phòng',

  // → Đà Nẵng
  'quang nam': 'Đà Nẵng',

  // → Cần Thơ
  'soc trang': 'Cần Thơ',
  'hau giang': 'Cần Thơ',

  // → Lào Cai
  'yen bai': 'Lào Cai',

  // → Tuyên Quang
  'ha giang': 'Tuyên Quang',

  // → Thái Nguyên
  'bac kan': 'Thái Nguyên',

  // → Phú Thọ
  'vinh phuc': 'Phú Thọ',
  'hoa binh': 'Phú Thọ',

  // → Bắc Ninh
  'bac giang': 'Bắc Ninh',

  // → Hưng Yên
  'thai binh': 'Hưng Yên',

  // → Ninh Bình
  'ha nam': 'Ninh Bình',
  'nam dinh': 'Ninh Bình',

  // → Quảng Trị
  'quang binh': 'Quảng Trị',

  // → Quảng Ngãi
  'kon tum': 'Quảng Ngãi',

  // → Gia Lai
  'binh dinh': 'Gia Lai',

  // → Đắk Lắk
  'phu yen': 'Đắk Lắk',

  // → Khánh Hòa
  'ninh thuan': 'Khánh Hòa',

  // → Lâm Đồng
  'binh thuan': 'Lâm Đồng',
  'dak nong': 'Lâm Đồng',

  // → Đồng Nai
  'binh phuoc': 'Đồng Nai',

  // → Tây Ninh
  'long an': 'Tây Ninh',

  // → Vĩnh Long
  'tra vinh': 'Vĩnh Long',
  'ben tre': 'Vĩnh Long',

  // → Đồng Tháp
  'tien giang': 'Đồng Tháp',

  // → Cà Mau
  'bac lieu': 'Cà Mau',

  // → An Giang
  'kien giang': 'An Giang',

  // Special: Thừa Thiên Huế (cũ) → Huế (TP trực thuộc TW từ 2025-01)
  'thua thien hue': 'Huế',
  'thua thien - hue': 'Huế',
};

/**
 * District / common neighborhood → province (post-merger).
 * Used as a last-resort hint when the address string contains no province name
 * at all. Keys are pre-normalized (lowercased + diacritics stripped).
 */
export const DISTRICT_HINT: Record<string, VNProvince> = {
  // Hà Nội
  'cau giay': 'Hà Nội',
  'ba dinh': 'Hà Nội',
  'hoan kiem': 'Hà Nội',
  'ha dong': 'Hà Nội',
  'long bien': 'Hà Nội',
  'thanh xuan': 'Hà Nội',
  'dong da': 'Hà Nội',
  'hai ba trung': 'Hà Nội',
  'tay ho': 'Hà Nội',
  'nam tu liem': 'Hà Nội',
  'bac tu liem': 'Hà Nội',
  'hoang mai': 'Hà Nội',
  'cau dien': 'Hà Nội',
  'my dinh': 'Hà Nội',
  'gia lam': 'Hà Nội',
  'dong anh': 'Hà Nội',
  'son tay': 'Hà Nội',
  'ha noi': 'Hà Nội',

  // TP.HCM (gồm Bình Dương, Bà Rịa-Vũng Tàu đã sáp nhập)
  'thu duc': 'TP. Hồ Chí Minh',
  'binh thanh': 'TP. Hồ Chí Minh',
  'phu nhuan': 'TP. Hồ Chí Minh',
  'tan binh': 'TP. Hồ Chí Minh',
  'tan phu': 'TP. Hồ Chí Minh',
  'go vap': 'TP. Hồ Chí Minh',
  'nha be': 'TP. Hồ Chí Minh',
  'binh chanh': 'TP. Hồ Chí Minh',
  'hoc mon': 'TP. Hồ Chí Minh',
  'cu chi': 'TP. Hồ Chí Minh',
  'thuan an': 'TP. Hồ Chí Minh',
  'di an': 'TP. Hồ Chí Minh',
  'thu dau mot': 'TP. Hồ Chí Minh',
  'sai gon': 'TP. Hồ Chí Minh',
  'ho chi minh': 'TP. Hồ Chí Minh',
  hcm: 'TP. Hồ Chí Minh',
  hcmc: 'TP. Hồ Chí Minh',
  tphcm: 'TP. Hồ Chí Minh',

  // Đà Nẵng (gồm Quảng Nam đã sáp nhập)
  'son tra': 'Đà Nẵng',
  'hai chau': 'Đà Nẵng',
  'ngu hanh son': 'Đà Nẵng',
  'lien chieu': 'Đà Nẵng',
  'cam le': 'Đà Nẵng',
  'thanh khe': 'Đà Nẵng',
  'tam ky': 'Đà Nẵng',
  'hoi an': 'Đà Nẵng',

  // Hải Phòng (gồm Hải Dương đã sáp nhập)
  'le chan': 'Hải Phòng',
  'ngo quyen': 'Hải Phòng',
  'kien an': 'Hải Phòng',
  'hong bang': 'Hải Phòng',

  // Cần Thơ (gồm Sóc Trăng, Hậu Giang)
  'ninh kieu': 'Cần Thơ',
  'cai rang': 'Cần Thơ',
  'binh thuy': 'Cần Thơ',

  // Huế
  hue: 'Huế',

  // Common unaccented / collapsed spellings
  hanoi: 'Hà Nội',
  saigon: 'TP. Hồ Chí Minh',

  // HCM district shorthand: "P14 Q10", "Q.Bình Thạnh", "Quận 1"..."Quận 12"
  'quan 1': 'TP. Hồ Chí Minh',
  'quan 2': 'TP. Hồ Chí Minh',
  'quan 3': 'TP. Hồ Chí Minh',
  'quan 4': 'TP. Hồ Chí Minh',
  'quan 5': 'TP. Hồ Chí Minh',
  'quan 6': 'TP. Hồ Chí Minh',
  'quan 7': 'TP. Hồ Chí Minh',
  'quan 8': 'TP. Hồ Chí Minh',
  'quan 9': 'TP. Hồ Chí Minh',
  'quan 10': 'TP. Hồ Chí Minh',
  'quan 11': 'TP. Hồ Chí Minh',
  'quan 12': 'TP. Hồ Chí Minh',
  // "Q4", "Q10" — common Vietnamese shorthand for HCM districts.
  ' q1 ': 'TP. Hồ Chí Minh',
  ' q2 ': 'TP. Hồ Chí Minh',
  ' q3 ': 'TP. Hồ Chí Minh',
  ' q4 ': 'TP. Hồ Chí Minh',
  ' q5 ': 'TP. Hồ Chí Minh',
  ' q6 ': 'TP. Hồ Chí Minh',
  ' q7 ': 'TP. Hồ Chí Minh',
  ' q8 ': 'TP. Hồ Chí Minh',
  ' q9 ': 'TP. Hồ Chí Minh',
  ' q10 ': 'TP. Hồ Chí Minh',
  ' q11 ': 'TP. Hồ Chí Minh',
  ' q12 ': 'TP. Hồ Chí Minh',
  'cong vien phan mem quang trung': 'TP. Hồ Chí Minh',
  'nghia do': 'Hà Nội',

  // Bỉm Sơn → Thanh Hóa
  'bim son': 'Thanh Hóa',
};

/**
 * Street-name fragments that contain a province name as a substring and would
 * otherwise produce a false positive. Stripped from the normalized input
 * before province matching runs.
 *
 * Add a new entry only when a real-world false positive is observed in the
 * report; over-pruning here would hide legitimate province mentions.
 */
const STREET_FALSE_POSITIVES: string[] = [
  // "Điện Biên Phủ" is a major street in HCM, Hà Nội, Đà Nẵng. Always strip
  // before matching so we don't mis-resolve to the actual Điện Biên province.
  'dien bien phu',
];

/** Strip Vietnamese diacritics and lowercase for matching. */
export function normalizeForMatch(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pre-computed normalized → display map for the 34 canonical provinces.
 * Built once at module load.
 */
const CANONICAL_BY_NORMALIZED: Map<string, VNProvince> = (() => {
  const m = new Map<string, VNProvince>();
  for (const p of VN_PROVINCES_34) {
    m.set(normalizeForMatch(p), p);
    // Also index without "tp." prefix so "ho chi minh" matches "TP. Hồ Chí Minh".
    m.set(normalizeForMatch(p).replace(/^tp\.?\s*/, ''), p);
  }
  return m;
})();

/**
 * Resolve any free-form Vietnamese address string to one of the 34 canonical
 * provinces. Returns null if nothing matches.
 *
 * Resolution order (first hit wins):
 *   1. Direct match against the 34 new provinces.
 *   2. Match against the old → new merger map.
 *   3. District/neighborhood hint.
 *
 * Implementation note: we scan with `.includes()` rather than splitting on
 * delimiters because addresses are inconsistent — sometimes comma-separated,
 * sometimes space-separated, sometimes embedded in a building name.
 */
export function resolveProvince(raw: string): VNProvince | null {
  let norm = normalizeForMatch(raw);
  if (!norm) return null;

  // Strip street-name fragments that would cause false positives
  // (e.g. "Điện Biên Phủ" street → don't match "Điện Biên" province).
  for (const phrase of STREET_FALSE_POSITIVES) {
    if (norm.includes(phrase)) {
      norm = norm.split(phrase).join(' ');
    }
  }
  // Pad with spaces so word-bounded hints like " q4 " can match at start/end.
  norm = ` ${norm} `.replace(/[.,;()/|]/g, ' ').replace(/\s+/g, ' ');

  // 1. Canonical 34 — longest-first so "ho chi minh" wins over a stray "minh".
  const canonicalKeys = [...CANONICAL_BY_NORMALIZED.keys()].sort(
    (a, b) => b.length - a.length,
  );
  for (const key of canonicalKeys) {
    if (norm.includes(key)) {
      const hit = CANONICAL_BY_NORMALIZED.get(key);
      if (hit) return hit;
    }
  }

  // 2. Old province names — longest-first for the same reason.
  const oldKeys = Object.keys(OLD_TO_NEW_PROVINCE).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of oldKeys) {
    if (norm.includes(key)) {
      return OLD_TO_NEW_PROVINCE[key];
    }
  }

  // 3. District/ward hint.
  const districtKeys = Object.keys(DISTRICT_HINT).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of districtKeys) {
    if (norm.includes(key)) {
      return DISTRICT_HINT[key];
    }
  }

  return null;
}
