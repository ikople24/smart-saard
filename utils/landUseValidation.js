/**
 * Server-side validation for land use survey data (Engineering Spec)
 * Validates structure and format; parcel total area check is client-side only.
 */

const VALID_LAND_USE_KEYS = [
  'agriculture', 'residential', 'commercial', 'industrial',
  'government', 'religious', 'vacant', 'other',
];

const AREA_STR_REGEX = /^\d+(\.\d+)?-\d+(\.\d+)?-\d+(\.\d+)?$/;

function isValidAreaStr(str) {
  if (!str || typeof str !== 'string') return false;
  return AREA_STR_REGEX.test(str.trim());
}

function isValidLandUseType(key) {
  return typeof key === 'string' && VALID_LAND_USE_KEYS.includes(key);
}

/**
 * Validate single land use assignment
 * @param {object} landUse - { types: string[], areas: Record<string,string> }
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateLandUseAssignment(landUse) {
  if (!landUse || typeof landUse !== 'object') {
    return { valid: false, error: 'landUse must be an object' };
  }

  const { types, areas } = landUse;

  if (!Array.isArray(types)) {
    return { valid: false, error: 'landUse.types must be an array' };
  }

  for (const t of types) {
    if (!isValidLandUseType(t)) {
      return { valid: false, error: `Invalid land use type: ${t}` };
    }
  }

  if (areas !== undefined && areas !== null) {
    if (typeof areas !== 'object' || Array.isArray(areas)) {
      return { valid: false, error: 'landUse.areas must be an object' };
    }
    for (const [key, val] of Object.entries(areas)) {
      if (!isValidLandUseType(key)) {
        return { valid: false, error: `Invalid area key: ${key}` };
      }
      if (val !== '' && val != null && !isValidAreaStr(String(val))) {
        return { valid: false, error: `Invalid area format for ${key}: expected R-N-W` };
      }
    }
  }

  return { valid: true };
}

/**
 * Validate parcel code
 */
export function validateParcelCode(parcelCode) {
  if (!parcelCode || typeof parcelCode !== 'string') {
    return { valid: false, error: 'parcelCode is required and must be a string' };
  }
  if (parcelCode.trim().length === 0) {
    return { valid: false, error: 'parcelCode cannot be empty' };
  }
  return { valid: true };
}
