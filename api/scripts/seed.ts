import * as dotenv from 'dotenv';
dotenv.config({ path: 'api/.env' });
import {
  PrismaClient,
  UserRole,
  SerialDisposition,
  SerialApprovalStatus,
  InspectionReportStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function provisionTenant(
  name: string,
  adminEmail: string,
  adminName: string,
  passwordString: string,
) {
  console.log(`\n--- Provisioning tenant "${name}" ---`);

  // Check if exist
  let tenant = await prisma.tenant.findFirst({ where: { name } });
  if (tenant) {
    console.log(`Tenant "${name}" already exists (ID: ${tenant.id}).`);
  } else {
    tenant = await prisma.tenant.create({
      data: { name },
    });
    console.log(`Tenant created with ID: ${tenant.id}`);
  }

  const hash = await bcrypt.hash(passwordString, 10);

  let user = await prisma.user.findUnique({
    where: {
      tenantId_email: {
        tenantId: tenant.id,
        email: adminEmail,
      },
    },
  });

  if (user) {
    console.log(
      `User "${adminEmail}" already exists. Updating password to ensure access.`,
    );
    user = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash },
    });
  } else {
    user = await prisma.user.create({
      data: {
        email: adminEmail,
        name: adminName,
        passwordHash: hash,
        role: UserRole.ADMIN,
        tenantId: tenant.id,
      },
    });
    console.log(`Admin user created. ID: ${user.id}`);
  }

  // Provision initial template
  const templateKey = 'DRILL_PIPE_REPORT';
  const existingTemplate = await prisma.template.findFirst({
    where: { tenantId: tenant.id, templateKey, status: 'ACTIVE' },
  });

  if (!existingTemplate) {
    console.log(
      `No active template found for ${templateKey}. Provisioning one...`,
    );
    const filePath = path.join(__dirname, 'valid-template.xlsx');
    if (fs.existsSync(filePath)) {
      const fileBuffer = fs.readFileSync(filePath);
      const fileHash = crypto
        .createHash('sha256')
        .update(fileBuffer)
        .digest('hex');

      await prisma.template.create({
        data: {
          tenantId: tenant.id,
          templateKey,
          templateVersion: 1,
          status: 'ACTIVE',
          fileBlob: fileBuffer,
          hash: fileHash,
          changeNote: 'Initial automated provision',
          createdById: user.id,
        },
      });
      console.log(`Template ${templateKey} v1 provisioned successfully.`);
    } else {
      console.warn(
        `Template file not found at ${filePath}. Skipping template provision.`,
      );
    }
  } else {
    console.log(`Active template for ${templateKey} already exists.`);
  }

  return tenant;
}

async function provisionRolesForTenant(
  tenant: any,
  domain: string,
  passwordString: string,
) {
  console.log(`\n--- Provisioning roles for "${tenant.name}" (@${domain}) ---`);
  const passwordHash = await bcrypt.hash(passwordString, 10);

  const users = [
    {
      email: `receiver@${domain}`,
      role: UserRole.RECEIVER,
      name: 'Charlie',
    },
    {
      email: `supervisor@${domain}`,
      role: UserRole.SUPERVISOR,
      name: 'Arezki',
    },
    {
      email: `inspector@${domain}`,
      role: UserRole.INSPECTOR,
      name: 'Sidi',
    },
  ];

  for (const u of users) {
    const existing = await prisma.user.findFirst({
      where: { email: u.email, tenantId: tenant.id },
    });
    if (!existing) {
      await prisma.user.create({
        data: {
          email: u.email,
          name: u.name,
          passwordHash,
          role: u.role,
          tenantId: tenant.id,
        },
      });
      console.log(`Created ${u.role}: ${u.email}`);
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: { name: u.name, passwordHash }, // update names and passwords to ensure consistent state
      });
      console.log(`Updated ${u.role}: ${u.email} (Name: ${u.name})`);
    }
  }
}

async function provisionNobleCorporation(tenant: any, passwordString: string) {
  console.log(`\n--- Provisioning Noble Corporation for "${tenant.name}" ---`);
  const passwordHash = await bcrypt.hash(passwordString, 10);

  let customer = await prisma.customer.findFirst({
    where: { name: 'Noble Corporation', tenantId: tenant.id },
  });
  if (!customer) {
    customer = await prisma.customer.create({
      data: {
        name: 'Noble Corporation',
        code: 'NCO',
        tenantId: tenant.id,
      },
    });
    console.log(`Customer created: ${customer.name}`);
  }

  const email = 'gswann@noblecorp.com';
  let user = await prisma.user.findFirst({
    where: { email, tenantId: tenant.id },
  });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Jerry Swann',
        passwordHash,
        role: UserRole.CUSTOMER,
        tenantId: tenant.id,
        customerId: customer.id,
      },
    });
    console.log(`User created: ${user.email}`);
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { customerId: customer.id, passwordHash },
    });
    console.log(`User updated: ${user.email}`);
  }

  const template = await prisma.template.findFirst({
    where: { tenantId: tenant.id, templateKey: 'DRILL_PIPE_REPORT' },
    orderBy: { templateVersion: 'desc' },
  });
  if (!template) {
    console.log('No template found, skipping report creation');
    return;
  }

  const receiverUser = await prisma.user.findFirst({
    where: { role: UserRole.RECEIVER, tenantId: tenant.id },
  });
  const inspectorUser = await prisma.user.findFirst({
    where: { role: UserRole.INSPECTOR, tenantId: tenant.id },
  });

  let report = await prisma.inspectionReport.findFirst({
    where: {
      customerId: customer.id,
      poNumber: 'PO-NOBLE-001',
      tenantId: tenant.id,
    },
  });

  if (!report) {
    report = await prisma.inspectionReport.create({
      data: {
        poNumber: 'PO-NOBLE-001',
        status: InspectionReportStatus.IN_INSPECTION,
        tenantId: tenant.id,
        customerId: customer.id,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        templateHash: template.hash,
        reportNumber: 'NOBLECORP-130326-151748',
      },
    });

    const now = new Date();
    await prisma.inspectionReportTransitionLog.createMany({
      data: [
        {
          inspectionReportId: report.id,
          fromStatus: InspectionReportStatus.DRAFT,
          toStatus: InspectionReportStatus.RECEIVED,
          userId: receiverUser?.id,
          timestamp: new Date(now.getTime() - 3600000 * 3),
        },
        {
          inspectionReportId: report.id,
          fromStatus: InspectionReportStatus.RECEIVED,
          toStatus: InspectionReportStatus.READY_FOR_CLEANING,
          userId: receiverUser?.id,
          timestamp: new Date(now.getTime() - 3600000 * 2),
        },
        {
          inspectionReportId: report.id,
          fromStatus: InspectionReportStatus.READY_FOR_CLEANING,
          toStatus: InspectionReportStatus.READY_FOR_INSPECTION,
          userId: receiverUser?.id,
          timestamp: new Date(now.getTime() - 3600000 * 1),
        },
        {
          inspectionReportId: report.id,
          fromStatus: InspectionReportStatus.READY_FOR_INSPECTION,
          toStatus: InspectionReportStatus.IN_INSPECTION,
          userId: inspectorUser?.id,
          timestamp: now,
        },
      ],
    });
    console.log(`Created report ${report.reportNumber} with transition logs`);
  } else {
    // Force report status to IN_INSPECTION as requested, update template to latest
    await prisma.inspectionReport.update({
      where: { id: report.id },
      data: {
        status: InspectionReportStatus.IN_INSPECTION,
        templateKey: template.templateKey,
        templateVersion: template.templateVersion,
        templateHash: template.hash,
      },
    });

    const logCount = await prisma.inspectionReportTransitionLog.count({
      where: { inspectionReportId: report.id },
    });
    if (logCount === 0) {
      const now = new Date();
      await prisma.inspectionReportTransitionLog.createMany({
        data: [
          {
            inspectionReportId: report.id,
            fromStatus: InspectionReportStatus.DRAFT,
            toStatus: InspectionReportStatus.RECEIVED,
            userId: receiverUser?.id,
            timestamp: new Date(now.getTime() - 3600000 * 3),
          },
          {
            inspectionReportId: report.id,
            fromStatus: InspectionReportStatus.RECEIVED,
            toStatus: InspectionReportStatus.READY_FOR_CLEANING,
            userId: receiverUser?.id,
            timestamp: new Date(now.getTime() - 3600000 * 2),
          },
          {
            inspectionReportId: report.id,
            fromStatus: InspectionReportStatus.READY_FOR_CLEANING,
            toStatus: InspectionReportStatus.READY_FOR_INSPECTION,
            userId: receiverUser?.id,
            timestamp: new Date(now.getTime() - 3600000 * 1),
          },
          {
            inspectionReportId: report.id,
            fromStatus: InspectionReportStatus.READY_FOR_INSPECTION,
            toStatus: InspectionReportStatus.IN_INSPECTION,
            userId: inspectorUser?.id,
            timestamp: now,
          },
        ],
      });
    }

    console.log(
      `Report ${report.reportNumber} already exists. Ensured status IN_INSPECTION and added logs.`,
    );
  }

  const genericBox = {
    minOD: '6 1/3"',
    condition: 'OK',
    hardBanding: 'OK - FLUSHED',
    minTongSpace: '8 1/4"',
    minBoxThreads: '5"',
    minEccShoulder: '5/8"',
    bevelDiameterMax: '1/16"', // Fixed minor typo from previous turn
    bevelDiameterMin: '6"',
    maxCounterBoreLength: '3/4"',
    maxCounterBoreDiameter: '5 5/16"',
  };
  const genericPin = {
    maxID: '2 3/4"',
    minOD: '6 1/2"',
    condition: 'SD',
    minTongSpace: '7 3/8"',
    minEccShoulder: '5/8"',
    bevelDiameterMax: '1/16"',
    bevelDiameterMin: '6"',
    lengthPinConnMax: '3/8"',
    lengthPinConnMin: '4"',
    maxLengthPinBase: '4"',
  };

  for (let i = 1; i <= 15; i++) {
    const serial = `NCO-SN-${i.toString().padStart(3, '0')}`;
    const isScrap = i === 13;
    const isRework = i === 5 || i === 10;
    const isHold = i === 2;
    const disposition = isScrap
      ? SerialDisposition.SCRAP
      : isRework
        ? SerialDisposition.REWORK
        : isHold
          ? SerialDisposition.HOLD
          : SerialDisposition.PASS;

    const inspectionData = {
      box: genericBox,
      pin: genericPin,
      body: {
        ipc: false,
        slipArea: 'ok',
        emiResult: disposition,
        bentJoints: false,
        odDecrease: 'OK',
        corrosionIn: false,
        corrosionOut: false,
        wallRemaining: '0.362"',
      },
      final: {
        isC2: false,
        isNew: false,
        isScrap: isScrap,
        isPremium: !isScrap && !isRework,
      },
      remarks: isScrap
        ? 'Heavy wall loss detected. Pipe failed beyond repair.'
        : isRework
          ? 'Thread damage found, requires re-threading.'
          : isHold
            ? 'Awaiting further client instructions on minor pitting.'
            : 'Passed all inspections.',
    };

    const existing = await prisma.serialNumber.findFirst({
      where: { tenantId: tenant.id, inspectionReportId: report.id, serial },
    });

    if (existing) {
      await prisma.serialNumber.update({
        where: { id: existing.id },
        data: {
          disposition: disposition,
          approvalStatus: SerialApprovalStatus.INSPECTED_DRAFT,
          inspectionData,
        },
      });
    } else {
      await prisma.serialNumber.create({
        data: {
          serial,
          inspectionReportId: report.id,
          tenantId: tenant.id,
          disposition: disposition,
          approvalStatus: SerialApprovalStatus.INSPECTED_DRAFT,
          inspectionData,
        },
      });
    }
  }

  // Cleanup ANY leftover child reports to ensure they're removed based on the latest needs
  await prisma.childReportSerialNumber.deleteMany({
    where: { childReport: { inspectionReportId: report.id } },
  });
  await prisma.childReportTransitionLog.deleteMany({
    where: { childReport: { inspectionReportId: report.id } },
  });
  await prisma.childReportRevision.deleteMany({
    where: { childReport: { inspectionReportId: report.id } },
  });
  await prisma.attachment.deleteMany({
    where: { childReport: { inspectionReportId: report.id } },
  });
  await prisma.inspectionApprovalBatchSerialNumber.deleteMany({
    where: { batch: { inspectionReportId: report.id } },
  });
  await prisma.inspectionApprovalBatch.deleteMany({
    where: { inspectionReportId: report.id },
  });
  await prisma.childReport.deleteMany({
    where: {
      inspectionReportId: report.id,
      tenantId: tenant.id,
    },
  });

  console.log(
    `All 15 serial numbers for report ${report.reportNumber} are now synced to INSPECTED_DRAFT status.`,
  );
}

async function main() {
  const argTenant = process.argv[2];
  const argEmail = process.argv[3];
  const argName = process.argv[4];
  const argPass = process.argv[5];

  if (argTenant && argEmail) {
    // Manual run with args
    const t = await provisionTenant(
      argTenant,
      argEmail,
      argName || 'Admin',
      argPass || 'password123',
    );
    const domainMatch = argEmail.match(/@(.+)$/);
    const domain = domainMatch ? domainMatch[1] : 'example.com';
    await provisionRolesForTenant(t, domain, argPass || 'password123');
  } else {
    // Default / Dev Bootstrap mode
    const t1 = await provisionTenant(
      'Oilfield Tubular Services',
      'admin@oilfield-tubular-services.com',
      'Anis Khelidj',
      'password123',
    );
    await provisionRolesForTenant(
      t1,
      'oilfield-tubular-services.com',
      'password123',
    );
    await provisionNobleCorporation(t1, 'secure!2026');

    console.log('\n--- Seed completed successfully! ---');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
