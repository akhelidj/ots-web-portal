
import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const API_URL = 'http://localhost:3000';
const prisma = new PrismaClient();

async function login(email: string, password = 'password123') {
  try {
    const res = await axios.post(`${API_URL}/auth/login`, { email, password });
    return res.data.accessToken;
  } catch (e: any) {
    console.error(`Login failed for ${email}:`, e.message);
    throw e;
  }
}

async function createTemplateVersion() {
    const existing = await prisma.templateVersion.findFirst({ where: { templateKey: 'TEST_TPL_FINAL', templateVersion: '1.0' }});
    if (existing) return existing;
    
    return await prisma.templateVersion.create({
        data: {
            templateKey: 'TEST_TPL_FINAL',
            templateVersion: '1.0',
            mappingJson: {},
            status: 'ACTIVE',
        }
    });
}

async function run() {
    console.log('--- Starting Final Verification ---');
    try {
        const adminToken = await login('verify-admin@ots.com');
        const receiverToken = await login('receiver@ots.com');
        const supervisorToken = await login('supervisor@ots.com');
        const inspectorToken = await login('inspector@ots.com');
        const customerToken = await login('customer@ots.com');
        
        console.log('✅ Logins successful');

        const template = await createTemplateVersion();
        const tenant = await prisma.tenant.findFirst({ where: { name: 'Oilfield Tubular Services' }});
        if (!tenant) throw new Error('Tenant not found');

        // Setup: Create Inspection Report
        let report = await prisma.inspectionReport.create({
            data: {
                poNumber: 'PO-FINAL-1',
                status: 'DRAFT',
                tenantId: tenant.id,
                templateVersionId: template.id,
            }
        });
        const reportId = report.id;
        console.log(`✅ Created Inspection Report ${reportId} in DRAFT`);

        // 1. Security (Customer)
        try {
            await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'RECEIVED' }, {
                headers: { Authorization: `Bearer ${customerToken}` }
            });
            console.error('❌ Security Fail: Customer should be 403');
        } catch (e: any) {
            if (e.response?.status === 403) console.log('✅ Security Pass: Customer got 403');
            else console.error(`❌ Security Fail: Expected 403, got ${e.response?.status}`);
        }

        // 2. Role Check (Inspector -> RECEIVED) - 403 now
        try {
            await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'RECEIVED' }, {
                headers: { Authorization: `Bearer ${inspectorToken}` }
            });
            console.error('❌ Role Fail: Inspector should not move Draft');
        } catch (e: any) {
             if (e.response?.status === 403) console.log('✅ Role Pass: Inspector got 403 for Draft move');
             else console.error(`❌ Role Fail: Expected 403, got ${e.response?.status}`);
        }

        // 3. Happy Path: Receiver -> RECEIVED
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'RECEIVED' }, {
            headers: { Authorization: `Bearer ${receiverToken}` }
        });
        console.log('✅ Happy Path: Receiver moved to RECEIVED');

        // 4. On Hold Logic
        // 4.1 Transition to ON_HOLD
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'ON_HOLD', reason: 'Waiting for parts' }, {
            headers: { Authorization: `Bearer ${supervisorToken}` }
        });
        console.log('✅ Moved to ON_HOLD');

        // 4.2 Check Available Transitions (Supervisor should see RECEIVED)
        const availRes = await axios.get(`${API_URL}/inspection-reports/${reportId}/transitions/available`, {
            headers: { Authorization: `Bearer ${supervisorToken}` }
        });
        if (availRes.data.includes('RECEIVED')) console.log('✅ On Hold Visibility Pass: Restorable status visible');
        else console.error(`❌ On Hold Visibility Fail: ${JSON.stringify(availRes.data)}`);

        // 4.3 Restore (Inspector - should be 403)
        try {
            await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'RECEIVED' }, {
                headers: { Authorization: `Bearer ${inspectorToken}` }
            });
            console.error('❌ On Hold Auth Fail: Inspector should not restore');
        } catch (e: any) {
             if (e.response?.status === 403) console.log('✅ On Hold Auth Pass: Inspector 403 on restore');
        }

        // 4.4 Restore (Supervisor - Happy Path)
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'RECEIVED' }, {
            headers: { Authorization: `Bearer ${supervisorToken}` }
        });
        console.log('✅ Restored from ON_HOLD');

        // 5. Move to PENDING_APPROVAL
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'READY_FOR_CLEANING' }, { headers: { Authorization: `Bearer ${receiverToken}` } });
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'READY_FOR_INSPECTION' }, { headers: { Authorization: `Bearer ${receiverToken}` } });
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'IN_INSPECTION' }, { headers: { Authorization: `Bearer ${inspectorToken}` } });
        
        await prisma.serialNumber.create({ data: { serial: 'SN-X', inspectionReportId: reportId }});
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'PENDING_APPROVAL' }, { headers: { Authorization: `Bearer ${inspectorToken}` } });

        // 6. Child Constraints
        const child = await prisma.childReport.create({ data: { status: 'PENDING_APPROVAL', inspectionReportId: reportId }}); // Start at Pending for speed
        
        try {
            await axios.post(`${API_URL}/child-reports/${child.id}/transition`, { toStatus: 'APPROVED' }, {
                headers: { Authorization: `Bearer ${supervisorToken}` }
            });
            console.error('❌ Child Constraint Fail: Should require attachment');
        } catch (e: any) {
             if (e.response?.status === 400) console.log('✅ Child Constraint Pass: Rejected without attachment');
        }

        await prisma.attachment.create({ data: { filename: 'x', url: 'x', childReportId: child.id }});
        await axios.post(`${API_URL}/child-reports/${child.id}/transition`, { toStatus: 'APPROVED', reason: 'First Approval' }, {
             headers: { Authorization: `Bearer ${supervisorToken}` }
        });
        console.log('✅ Child Approved');

        // Check Revision 1 Reason
        const childRev1 = await prisma.childReportRevision.findFirst({ where: { childReportId: child.id, revisionNumber: 1 }});
        if (childRev1?.reason === 'First Approval') console.log('✅ Child Revision Pass: Determinisitc Reason');
        else console.error(`❌ Child Revision Fail: Reason is ${childRev1?.reason}`);

        // 7. Parent Approval & Reopen logic
        // Approve Parent
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'APPROVED', reason: 'Parent Approval' }, {
            headers: { Authorization: `Bearer ${supervisorToken}` }
        });
        console.log('✅ Parent Approved');

        // Reopen Parent (Admin)
        await axios.post(`${API_URL}/inspection-reports/${reportId}/transition`, { toStatus: 'IN_INSPECTION', reason: 'Reopen for Fix' }, {
            headers: { Authorization: `Bearer ${adminToken}` }
        });
        console.log('✅ Parent Reopened');
        
        // 8. Verify Snapshot Boundary
        const parentRev2 = await prisma.inspectionReportRevision.findFirst({ where: { inspectionReportId: reportId, revisionNumber: 2 }});
        // Snapshot status should be 'APPROVED' (the state being left), not 'IN_INSPECTION'
        if (parentRev2?.snapshotJson && (parentRev2.snapshotJson as any).status === 'APPROVED') {
            console.log('✅ Reopen Snapshot Pass: Snapshot status is APPROVED');
        } else {
            console.error(`❌ Reopen Snapshot Fail: Status is ${(parentRev2?.snapshotJson as any)?.status}`);
        }

    } catch (e: any) {
        console.error('Test Script Failed:', e.message);
        if (e.response) console.error('Response:', e.response.data);
    } finally {
        await prisma.$disconnect();
    }
}

run();
