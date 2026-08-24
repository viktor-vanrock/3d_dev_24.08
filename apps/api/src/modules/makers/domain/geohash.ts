const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function encodeGeohash(lat: number, lng: number, precision = 7): string {
  let latMin = -90;
  let latMax = 90;
  let lngMin = -180;
  let lngMax = 180;
  let even = true;
  let bit = 0;
  let index = 0;
  let result = "";
  while (result.length < precision) {
    if (even) {
      const middle = (lngMin + lngMax) / 2;
      if (lng >= middle) {
        index = (index << 1) | 1;
        lngMin = middle;
      } else {
        index <<= 1;
        lngMax = middle;
      }
    } else {
      const middle = (latMin + latMax) / 2;
      if (lat >= middle) {
        index = (index << 1) | 1;
        latMin = middle;
      } else {
        index <<= 1;
        latMax = middle;
      }
    }
    even = !even;
    if (bit < 4) bit += 1;
    else {
      result += BASE32[index];
      bit = 0;
      index = 0;
    }
  }
  return result;
}
