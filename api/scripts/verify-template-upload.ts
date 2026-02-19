
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as FormData from 'form-data';

const API_URL = 'http://localhost:3000';

async function verify() {
  try {
    // 1. Login as Admin
    console.log('Login as Admin...');
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      email: 'verify-admin@ots.com',
      password: 'password123',
      tenantName: 'Oilfield Tubular Services',
    });
    const token = loginRes.data.accessToken;
    console.log('Logged in.');

    // 2. Upload Valid Template (Version 1)
    console.log('Uploading Template v1...');
    const filePath = path.join(__dirname, 'valid-template.xlsx');
    if (!fs.existsSync(filePath)) {
      throw new Error('Run generate-test-template.ts first');
    }

    const form1 = new FormData();
    form1.append('file', fs.createReadStream(filePath));
    form1.append('templateKey', 'DRILL_PIPE_REPORT');
    form1.append('changeNote', 'Initial version');

    const res1 = await axios.post(`${API_URL}/templates`, form1, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form1.getHeaders(),
      },
    });
    console.log('v1 Upload Success:', res1.data);
    if (res1.data.templateVersion !== 1) throw new Error('Expected v1');
    if (res1.data.status !== 'ACTIVE') throw new Error('Expected ACTIVE');

    // 3. Upload Valid Template (Version 2)
    console.log('Uploading Template v2 (Same Key)...');
    const form2 = new FormData();
    form2.append('file', fs.createReadStream(filePath));
    form2.append('templateKey', 'DRILL_PIPE_REPORT');
    form2.append('changeNote', 'Second version');

    const res2 = await axios.post(`${API_URL}/templates`, form2, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...form2.getHeaders(),
      },
    });
    console.log('v2 Upload Success:', res2.data);
    if (res2.data.templateVersion !== 2) throw new Error('Expected v2');

    // 4. Verify List & Deprecation
    console.log('Listing templates...');
    const listRes = await axios.get(`${API_URL}/templates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const templates = listRes.data;
    console.log('Templates found:', templates.length);
    
    const v1 = templates.find((t: any) => t.templateVersion === 1);
    const v2 = templates.find((t: any) => t.templateVersion === 2);
    
    if (v1.status !== 'DEPRECATED') throw new Error('v1 should be DEPRECATED');
    if (v2.status !== 'ACTIVE') throw new Error('v2 should be ACTIVE');

    console.log('Verification Passed!');
  } catch (error: any) {
    console.error('Verification Failed:', error.response?.data || error.message);
    process.exit(1);
  }
}

verify();
