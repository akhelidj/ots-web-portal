const rawValues = {
  'box.minTongSpace': '1',
  'final.isNew': true,
  'final.disposition': 'PASS',
};

function setNestedValue(obj, path, value) {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current !== 'object' || current === null) return;
    if (!current[parts[i]]) {
      current[parts[i]] = {};
    }
    current = current[parts[i]];
  }
  if (typeof current !== 'object' || current === null) return;
  current[parts[parts.length - 1]] = value;
}

const finalResult = {};
for (const key of Object.keys(rawValues)) {
  setNestedValue(finalResult, key, rawValues[key]);
}

console.log(JSON.stringify(finalResult, null, 2));
