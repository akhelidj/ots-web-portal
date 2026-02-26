import * as ExcelJS from 'exceljs';

export async function mapDrillPipeReportV1(
  workbook: ExcelJS.Workbook,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  snapshot: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serialNumbersChunk: any[],
): Promise<void> {
  // Target the first sheet assuming it's the main template
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Template does not contain any worksheets');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = (snapshot.header || snapshot) as any;

  // 1. Prepare Top-Level Replacements
  const reportDate = h.updatedAt
    ? new Date(h.updatedAt).toLocaleDateString()
    : h.createdAt ? new Date(h.createdAt).toLocaleDateString() : 'N/A';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const eqNames = ((h.equipmentUsed || snapshot.equipmentUsed) as any[] || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any) => `${e.name}${e.number ? ' #' + e.number : ''}`).join(', ') || 'None specified';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mNames = ((h.inspectionMethod || snapshot.inspectionMethod) as any[] || [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((m: any) => m.name || m).join(', ') || 'None specified';

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

  const globalTokens: Record<string, string> = {
    '{{customer}}': h.customerName || 'N/A',
    '{{reportNumber}}': h.reportNumber || 'N/A',
    '{{reportDate}}': reportDate,
    '{{poNumber}}': h.poNumber || 'N/A',
    '{{standardUsed}}': h.standardUsed || 'N/A',
    '{{inspectionAddress}}': h.inspectionAddress || 'N/A',
    '{{grade}}': h.grade || 'N/A',
    '{{range}}': h.range || 'N/A',
    '{{weight}}': h.weight || 'N/A',
    '{{nomWT}}': h.nomWT || 'N/A',
    '{{nomOD}}': h.nomOD || 'N/A',
    '{{nomID}}': h.nomID || 'N/A',
    '{{connection}}': h.connection || 'N/A',
    '{{equipment}}': eqNames,
    '{{methods}}': mNames,
    '{{inspectorComment}}': h.inspectorComment || snapshot.inspectorComment || 'No comments provided.',
    '{{inspectedBy}}': inspectedByName,
    '{{approvedBy}}': approvedByName,
  };

  // 2. Locate the Template Row for Serial Numbers (contains {{sn}})
  let templateRowIndex = -1;
  sheet.eachRow((row, rowNumber) => {
    row.eachCell((cell) => {
      if (cell.type === ExcelJS.ValueType.String && cell.value.toString().includes('{{sn}}')) {
        templateRowIndex = rowNumber;
      }
    });
  });

  // 3. Process Serial Numbers (if template row found)
  if (templateRowIndex > -1) {
    const templateRow = sheet.getRow(templateRowIndex);
    // Format requested by user: 1 for Yes, 0 for No
    const yesNo = (val: unknown) => (val === undefined || val === null ? '' : val ? '1' : '0');

    // Make room for the new rows below the template row
    if (serialNumbersChunk.length > 0) {
      // exceljs specific: insert empty rows to make room
      sheet.spliceRows(templateRowIndex + 1, 0, ...new Array(serialNumbersChunk.length).fill([]));

      // Now fill injected rows
      for (let i = 0; i < serialNumbersChunk.length; i++) {
        const sn = serialNumbersChunk[i];
        const newRowIndex = templateRowIndex + 1 + i;
        const newRow = sheet.getRow(newRowIndex);

        // Copy row properties and cell styles from templateRow
        newRow.height = templateRow.height;
        newRow.hidden = templateRow.hidden;
        templateRow.eachCell({ includeEmpty: true }, (templateCell, colNumber) => {
          const newCell = newRow.getCell(colNumber);
          newCell.value = templateCell.value;
          newCell.style = Object.assign({}, templateCell.style);
        });

        const d = sn.inspectionData || sn.inspectionJson || {};
        const box   = d.box   || {};
        const pin   = d.pin   || {};
        const body  = d.body  || {};
        const final = d.final || {};

        const boxBvl  = box.bevelDiameterMin  ? `${box.bevelDiameterMin}-${box.bevelDiameterMax || ''}`   : '';
        const pinConn = pin.lengthPinConnMin  ? `${pin.lengthPinConnMin}-${pin.lengthPinConnMax || ''}`   : '';
        const pinBvl  = pin.bevelDiameterMin  ? `${pin.bevelDiameterMin}-${pin.bevelDiameterMax || ''}`   : '';

        const rowTokens: Record<string, string> = {
          '{{sn}}': sn.serial || sn.serialNumber || sn.value || '',
          '{{b_ts}}': box.minTongSpace || '',
          '{{b_od}}': box.minOD || '',
          '{{b_thd}}': box.minBoxThreads || '',
          '{{b_ecc}}': box.minEccShoulder || '',
          '{{b_cbd}}': box.maxCounterBoreDiameter || '',
          '{{b_cbl}}': box.maxCounterBoreLength || '',
          '{{b_bvl}}': boxBvl,
          '{{b_cond}}': box.condition || '',
          '{{b_hard}}': box.hardBanding || '',
          '{{p_ts}}': pin.minTongSpace || '',
          '{{p_od}}': pin.minOD || '',
          '{{p_id}}': pin.maxID || '',
          '{{p_ecc}}': pin.minEccShoulder || '',
          '{{p_conn}}': pinConn,
          '{{p_base}}': pin.maxLengthPinBase || '',
          '{{p_bvl}}': pinBvl,
          '{{p_cond}}': pin.condition || '',
          '{{wall}}': body.wallRemaining || '',
          '{{od_decr}}': body.odDecrease || '',
          '{{emi}}': body.emiResult || '',
          '{{slip}}': body.slipArea || '',
          '{{corr_in}}': yesNo(body.corrosionIn),
          '{{corr_out}}': yesNo(body.corrosionOut),
          '{{ipc}}': yesNo(body.ipc),
          '{{bent}}': yesNo(body.bentJoints),
          '{{jc_new}}': final.isNew ? 'X' : '',
          '{{jc_prem}}': final.isPremium ? 'X' : '',
          '{{jc_c2}}': final.isC2 ? 'X' : '',
          '{{jc_scrap}}': final.isScrap ? 'X' : '',
          '{{remarks}}': final.condition_notes || final.remarks || d.remarks || '',
        };

        // Replace tokens in the new row
        newRow.eachCell({ includeEmpty: false }, (cell) => {
          // If the cell is part of a merge but it's not the top-left master cell, do not modify its value
          // Otherwise exceljs will silently break the merge
          if (cell.isMerged && cell.master !== cell) {
            return;
          }
          
          if (cell.type === ExcelJS.ValueType.String) {
            let strValue = cell.value.toString();
            let replaced = false;
            for (const [token, value] of Object.entries(rowTokens)) {
              if (strValue.includes(token)) {
                strValue = strValue.replace(new RegExp(token, 'g'), value.toString());
                replaced = true;
              }
            }
            if (replaced) {
              cell.value = strValue;
            }
          }
        });
        
        newRow.commit();
      }
    }

    // Delete the original template row
    sheet.spliceRows(templateRowIndex, 1);
  }

  // 4. Perform Global Replacement
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      // Avoid breaking merges
      if (cell.isMerged && cell.master !== cell) {
        return;
      }

      if (cell.type === ExcelJS.ValueType.String) {
        let strValue = cell.value.toString();
        let replaced = false;
        for (const [token, value] of Object.entries(globalTokens)) {
          if (strValue.includes(token)) {
            strValue = strValue.replace(new RegExp(token, 'g'), value.toString());
            replaced = true;
          }
        }
        if (replaced) {
          cell.value = strValue;
        }
      }
    });
  });

}
