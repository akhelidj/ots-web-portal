import * as ExcelJS from 'exceljs';

// Column layout (31 total) — mirrors the UI Equipment List table exactly:
// A          = Serial No.
// B..J (9)  = Box Connection:  Tong Spc | Min OD | Box Thd | Ecc Sh | CBor D | CBor L | Bvl D | Cond | Hard B
// K..R (8)  = Pin Connection:  Tong Spc | Min OD | Max ID  | Ecc Sh | P. Conn| P. Base| Bvl D | Cond
// S..Z (8)  = Tube Body:       Wall R   | OD Decr| EMI Res | Slip   | Corr In| Corr Out| IPC  | Bent Jts
// AA..AD(4) = Joint Class:     New | Premium | C2 | Scrap
// AE        = Remarks

const LAST_COL = 'AE';
const TOTAL_COLS = 31;

export async function mapDrillPipeReportV1(
  workbook: ExcelJS.Workbook,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshot: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serialNumbersChunk: any[],
): Promise<void> {
  // Remove the 'ok' validation sheet entirely so it doesn't appear in the export
  const okSheet = workbook.getWorksheet('ok');
  if (okSheet) {
    workbook.removeWorksheet(okSheet.id);
  }

  // Target the correct output sheet by name
  const sheet = workbook.getWorksheet('Drill Pipe summary');
  if (!sheet) {
    throw new Error('Template does not contain a "Drill Pipe summary" worksheet');
  }

  // Clear existing template data
  sheet.spliceRows(1, 1000);

  // ── Column widths ──────────────────────────────────────────────────────────
  sheet.columns = [
    { key: 'sn',        width: 16 }, // A  Serial No.
    { key: 'b_ts',      width: 8  }, // B  Box Tong Spc.
    { key: 'b_od',      width: 8  }, // C  Box Min OD
    { key: 'b_thd',     width: 8  }, // D  Box Thd.
    { key: 'b_ecc',     width: 8  }, // E  Box Ecc Sh.
    { key: 'b_cbd',     width: 8  }, // F  Box CBor D.
    { key: 'b_cbl',     width: 8  }, // G  Box CBor L.
    { key: 'b_bvl',     width: 10 }, // H  Box Bvl D.
    { key: 'b_cond',    width: 7  }, // I  Box Cond.
    { key: 'b_hard',    width: 7  }, // J  Box Hard B.
    { key: 'p_ts',      width: 8  }, // K  Pin Tong Spc.
    { key: 'p_od',      width: 8  }, // L  Pin Min OD
    { key: 'p_id',      width: 8  }, // M  Pin Max ID
    { key: 'p_ecc',     width: 8  }, // N  Pin Ecc Sh.
    { key: 'p_conn',    width: 10 }, // O  Pin P. Conn
    { key: 'p_base',    width: 8  }, // P  Pin P. Base
    { key: 'p_bvl',     width: 10 }, // Q  Pin Bvl D.
    { key: 'p_cond',    width: 7  }, // R  Pin Cond.
    { key: 'wall',      width: 8  }, // S  Wall R.
    { key: 'od_decr',   width: 8  }, // T  OD Decr.
    { key: 'emi',       width: 8  }, // U  EMI Res.
    { key: 'slip',      width: 8  }, // V  Slip Area
    { key: 'corr_in',   width: 7  }, // W  Corr. In
    { key: 'corr_out',  width: 7  }, // X  Corr. Out
    { key: 'ipc',       width: 6  }, // Y  IPC
    { key: 'bent',      width: 7  }, // Z  Bent Jts
    { key: 'jc_new',    width: 7  }, // AA New
    { key: 'jc_prem',   width: 8  }, // AB Premium
    { key: 'jc_c2',     width: 6  }, // AC C2
    { key: 'jc_scrap',  width: 7  }, // AD Scrap
    { key: 'remarks',   width: 30 }, // AE Remarks
  ];

  // ── Style helpers ──────────────────────────────────────────────────────────
  const primaryFill: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  const secondaryFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
  const accentFill: ExcelJS.Fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  const sectionFill: ExcelJS.Fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
  const textWhite: Partial<ExcelJS.Font> = { color: { argb: 'FFFFFFFF' }, bold: true, size: 10 };
  const textBold:  Partial<ExcelJS.Font> = { bold: true, size: 10 };
  const textLabel: Partial<ExcelJS.Font> = { bold: true, size: 9, color: { argb: 'FF64748B' } };
  const borderAll: Partial<ExcelJS.Borders> = {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };
  const borderBottom = { bottom: { style: 'thin' as const, color: { argb: 'FFCBD5E1' } } };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = (snapshot.header || snapshot) as any;

  let currentRow = 1;

  // ── TITLE ─────────────────────────────────────────────────────────────────
  sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow + 1}`);
  const titleCell = sheet.getCell(`A${currentRow}`);
  titleCell.value = 'DRILL PIPE INSPECTION REPORT';
  titleCell.font = { size: 16, bold: true, color: { argb: 'FF0F172A' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  titleCell.fill = accentFill;
  currentRow += 3;

  // ── Meta helpers ───────────────────────────────────────────────────────────
  const setLabel = (cell: string, text: string) => {
    sheet.getCell(cell).value = text;
    sheet.getCell(cell).font = textLabel;
    sheet.getCell(cell).alignment = { horizontal: 'right' };
  };
  const setVal = (from: string, to: string, text: string) => {
    sheet.mergeCells(`${from}:${to}`);
    sheet.getCell(from).value = text;
    sheet.getCell(from).border = { bottom: borderBottom.bottom };
    sheet.getCell(from).font = { size: 10 };
  };
  const addMetaRow = (l1: string, v1: string, l2: string, v2: string) => {
    setLabel(`A${currentRow}`, l1);
    setVal(`B${currentRow}`, `F${currentRow}`, v1);
    setLabel(`I${currentRow}`, l2);
    setVal(`J${currentRow}`, `O${currentRow}`, v2);
    currentRow += 2;
  };

  // ── INSPECTION REPORT INFORMATION ─────────────────────────────────────────
  sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`);
  const irHeader = sheet.getCell(`A${currentRow}`);
  irHeader.value = 'INSPECTION REPORT INFORMATION';
  irHeader.fill = primaryFill;
  irHeader.font = textWhite;
  currentRow++;

  const reportDate = h.updatedAt
    ? new Date(h.updatedAt).toLocaleDateString()
    : h.createdAt ? new Date(h.createdAt).toLocaleDateString() : 'N/A';

  addMetaRow('Report No:', h.reportNumber || 'N/A', 'Date:', reportDate);
  addMetaRow('PO / Work Order:', h.poNumber || 'N/A', 'Standard Used:', h.standardUsed || 'N/A');
  addMetaRow('Address of Inspection:', h.inspectionAddress || 'N/A', '', '');
  currentRow++;

  // ── PIPE SPECIFICATIONS ────────────────────────────────────────────────────
  sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`);
  const pipeHeader = sheet.getCell(`A${currentRow}`);
  pipeHeader.value = 'PIPE SPECIFICATIONS';
  pipeHeader.fill = primaryFill;
  pipeHeader.font = textWhite;
  currentRow++;

  addMetaRow('Grade:', h.grade || 'N/A', 'Range:', h.range || 'N/A');

  setLabel(`A${currentRow}`, 'Weight:');
  setVal(`B${currentRow}`, `F${currentRow}`, h.weight || 'N/A');
  setLabel(`I${currentRow}`, 'Nom. W.T:');
  setVal(`J${currentRow}`, `O${currentRow}`, h.nomWT || 'N/A');
  currentRow += 2;

  addMetaRow('Nom. OD:', h.nomOD || 'N/A', 'Nom. ID:', h.nomID || 'N/A');
  addMetaRow('Connection:', h.connection || 'N/A', '', '');
  currentRow++;

  // ── EQUIPMENT & METHODS ────────────────────────────────────────────────────
  sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`);
  const eqBanner = sheet.getCell(`A${currentRow}`);
  eqBanner.value = 'EQUIPMENT & METHODS USED';
  eqBanner.fill = primaryFill;
  eqBanner.font = textWhite;
  currentRow++;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eqNames = ((h.equipmentUsed || snapshot.equipmentUsed) as any[] || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => `${e.name}${e.number ? ' #' + e.number : ''}`).join(', ') || 'None specified';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mNames = ((h.inspectionMethod || snapshot.inspectionMethod) as any[] || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => m.name || m).join(', ') || 'None specified';

  sheet.mergeCells(`A${currentRow}:P${currentRow}`);
  const eqCell = sheet.getCell(`A${currentRow}`);
  eqCell.value = `Equipment: ${eqNames}`;
  eqCell.font = { italic: true, size: 9 };
  eqCell.fill = sectionFill;

  sheet.mergeCells(`Q${currentRow}:${LAST_COL}${currentRow}`);
  const mCell = sheet.getCell(`Q${currentRow}`);
  mCell.value = `Methods: ${mNames}`;
  mCell.font = { italic: true, size: 9 };
  mCell.fill = sectionFill;
  currentRow += 2;

  // ── DATA TABLE ─────────────────────────────────────────────────────────────
  const applyHeaderStyle = (cellStr: string, title: string) => {
    const c = sheet.getCell(cellStr);
    c.value = title;
    c.fill = primaryFill;
    c.font = textWhite;
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = borderAll;
  };

  // Group headers
  applyHeaderStyle(`A${currentRow}`, 'PIPE INFO');

  sheet.mergeCells(`B${currentRow}:J${currentRow}`);
  applyHeaderStyle(`B${currentRow}`, 'BOX CONNECTION (TOOL JOINT)');

  sheet.mergeCells(`K${currentRow}:R${currentRow}`);
  applyHeaderStyle(`K${currentRow}`, 'PIN CONNECTION (TOOL JOINT)');

  sheet.mergeCells(`S${currentRow}:Z${currentRow}`);
  applyHeaderStyle(`S${currentRow}`, 'TUBE BODY');

  sheet.mergeCells(`AA${currentRow}:AD${currentRow}`);
  applyHeaderStyle(`AA${currentRow}`, 'JOINT CLASS');

  applyHeaderStyle(`AE${currentRow}`, 'FINAL REMARKS');
  currentRow++;

  // Sub headers (row 2 of header)
  const subHeaders: [string, string][] = [
    ['A', 'Serial No.'],
    // Box
    ['B', 'Tong Spc.'], ['C', 'Min OD'], ['D', 'Box Thd.'], ['E', 'Ecc Sh.'],
    ['F', 'CBor D.'],   ['G', 'CBor L.'], ['H', 'Bvl D.'],  ['I', 'Cond.'], ['J', 'Hard B.'],
    // Pin
    ['K', 'Tong Spc.'], ['L', 'Min OD'], ['M', 'Max ID'],   ['N', 'Ecc Sh.'],
    ['O', 'P. Conn'],   ['P', 'P. Base'], ['Q', 'Bvl D.'],  ['R', 'Cond.'],
    // Body
    ['S', 'Wall R.'],   ['T', 'OD Decr.'], ['U', 'EMI Res.'], ['V', 'Slip Area'],
    ['W', 'Corr. In'],  ['X', 'Corr. Out'], ['Y', 'IPC'],    ['Z', 'Bent Jts'],
    // Joint Class
    ['AA', 'NEW'], ['AB', 'PREM'], ['AC', 'C2'], ['AD', 'SCRAP'],
    // Remarks
    ['AE', 'Remarks'],
  ];
  subHeaders.forEach(([col, label]) => applyHeaderStyle(`${col}${currentRow}`, label));
  currentRow++;

  // ── Serial data rows ───────────────────────────────────────────────────────
  if (serialNumbersChunk.length === 0) {
    sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`);
    const c = sheet.getCell(`A${currentRow}`);
    c.value = 'No serial numbers in this report.';
    c.alignment = { horizontal: 'center' };
    currentRow++;
  }

  const yesNo = (val: unknown) => (val === undefined || val === null ? '' : val ? 'Yes' : 'No');

  for (const sn of serialNumbersChunk) {
    const d = sn.inspectionData || sn.inspectionJson || {};
    const box   = d.box   || {};
    const pin   = d.pin   || {};
    const body  = d.body  || {};
    const final = d.final || {};

    const boxBvl  = box.bevelDiameterMin  ? `${box.bevelDiameterMin}-${box.bevelDiameterMax || ''}`   : '';
    const pinConn = pin.lengthPinConnMin  ? `${pin.lengthPinConnMin}-${pin.lengthPinConnMax || ''}`   : '';
    const pinBvl  = pin.bevelDiameterMin  ? `${pin.bevelDiameterMin}-${pin.bevelDiameterMax || ''}`   : '';

    const rowValues = [
      // A  Serial No.
      sn.serial || sn.serialNumber || sn.value || '',
      // B-J  Box
      box.minTongSpace            || '',
      box.minOD                   || '',
      box.minBoxThreads           || '',
      box.minEccShoulder          || '',
      box.maxCounterBoreDiameter  || '',
      box.maxCounterBoreLength    || '',
      boxBvl,
      box.condition               || '',
      box.hardBanding             || '',
      // K-R  Pin
      pin.minTongSpace            || '',
      pin.minOD                   || '',
      pin.maxID                   || '',
      pin.minEccShoulder          || '',
      pinConn,
      pin.maxLengthPinBase        || '',
      pinBvl,
      pin.condition               || '',
      // S-Z  Body
      body.wallRemaining          || '',
      body.odDecrease             || '',
      body.emiResult              || '',
      body.slipArea               || '',
      yesNo(body.corrosionIn),
      yesNo(body.corrosionOut),
      yesNo(body.ipc),
      yesNo(body.bentJoints),
      // AA-AD  Joint Class
      final.isNew     ? 'X' : '',
      final.isPremium ? 'X' : '',
      final.isC2      ? 'X' : '',
      final.isScrap   ? 'X' : '',
      // AE  Remarks
      final.condition_notes || final.remarks || d.remarks || '',
    ];

    const row = sheet.getRow(currentRow);
    row.values = rowValues;
    row.height = 22;

    row.eachCell((cell, col) => {
      cell.border = borderAll;
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      // Remarks: left-align
      if (col === TOTAL_COLS) {
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      }
      // Joint class X colouring: col 27=New,28=Prem,29=C2,30=Scrap
      if (col >= 27 && col <= 30 && cell.value === 'X') {
        cell.font = { bold: true, color: { argb: col === 30 ? 'FFDC2626' : 'FF16A34A' } };
      }
    });

    // Alternating row shading
    if (currentRow % 2 === 0) {
      for (let i = 1; i <= TOTAL_COLS; i++) {
        row.getCell(i).fill = secondaryFill;
      }
    }

    currentRow++;
  }
  currentRow++;

  // Legend
  sheet.mergeCells(`AA${currentRow}:AD${currentRow}`);
  const legCell = sheet.getCell(`AA${currentRow}`);
  legCell.value = 'X = classification assigned. Green = Pass, Red = Scrap.';
  legCell.font = { italic: true, size: 9, color: { argb: 'FF64748B' } };
  currentRow += 2;

  // ── FOOTER: Comments & Approval ────────────────────────────────────────────
  sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow}`);
  const fHeader = sheet.getCell(`A${currentRow}`);
  fHeader.value = 'COMMENTS & APPROVAL';
  fHeader.fill = primaryFill;
  fHeader.font = textWhite;
  currentRow++;

  sheet.getCell(`A${currentRow}`).value = 'Overall Inspector Comment:';
  sheet.getCell(`A${currentRow}`).font = textBold;
  currentRow++;

  sheet.mergeCells(`A${currentRow}:${LAST_COL}${currentRow + 3}`);
  const commentCell = sheet.getCell(`A${currentRow}`);
  commentCell.value = h.inspectorComment || snapshot.inspectorComment || 'No comments provided.';
  commentCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
  commentCell.border = borderAll;
  currentRow += 5;

  // Signatures
  let inspectedByName = 'N/A';
  let approvedByName  = 'N/A';

  const transitionLogs = snapshot.transitionLogs || [];
  if (Array.isArray(transitionLogs) && transitionLogs.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asc = [...transitionLogs].sort((a: any, b: any) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inspectLog = asc.find((l: any) => l.toStatus === 'IN_INSPECTION' || l.toStatus === 'PENDING_APPROVAL');
    if (inspectLog?.userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (snapshot.users || []).find((u: any) => u.id === inspectLog.userId);
      if (u) inspectedByName = u.name || u.email;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const approveLog = [...asc].reverse().find((l: any) => l.toStatus === 'APPROVED' || l.toStatus === 'CLOSED');
    if (approveLog?.userId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const u = (snapshot.users || []).find((u: any) => u.id === approveLog.userId);
      if (u) approvedByName = u.name || u.email;
    }
  }

  sheet.getCell(`A${currentRow}`).value = 'Inspected By:';
  sheet.getCell(`A${currentRow}`).font = textBold;
  sheet.mergeCells(`B${currentRow}:G${currentRow}`);
  sheet.getCell(`B${currentRow}`).value = inspectedByName;
  sheet.getCell(`B${currentRow}`).border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };

  sheet.getCell(`M${currentRow}`).value = 'Approved By:';
  sheet.getCell(`M${currentRow}`).font = textBold;
  sheet.mergeCells(`N${currentRow}:S${currentRow}`);
  sheet.getCell(`N${currentRow}`).value = approvedByName;
  sheet.getCell(`N${currentRow}`).border = { bottom: { style: 'thin', color: { argb: 'FF000000' } } };
}
