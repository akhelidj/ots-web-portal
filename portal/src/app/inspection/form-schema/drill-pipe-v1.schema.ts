export type FieldInputType = 'text' | 'number' | 'boolean' | 'select';

export interface FieldSchema {
  key: string;       // e.g. "box.minTongSpace" or "final.disposition"
  label: string;
  inputType: FieldInputType;
  required: boolean;
  options?: string[]; // strictly for select
}

export interface SectionSchema {
  key: string;       // e.g. "box"
  title: string;
  fields: FieldSchema[];
}

export interface FormSchema {
  templateKey: string;
  templateVersion: number;
  sections: SectionSchema[];
}

export const DRILL_PIPE_V1_SCHEMA: FormSchema = {
  templateKey: 'DRILL_PIPE_REPORT',
  templateVersion: 1,
  sections: [
    {
      key: 'box',
      title: 'Box Connection',
      fields: [
        { key: 'box.minTongSpace', label: 'Min Tong Space', inputType: 'text', required: true },
        { key: 'box.minOD', label: 'Min OD', inputType: 'text', required: true },
        { key: 'box.minBoxThreads', label: 'Min Box Threads', inputType: 'text', required: true },
        { key: 'box.minEccShoulder', label: 'Min Ecc Shoulder', inputType: 'text', required: true },
        { key: 'box.maxCounterBoreDiameter', label: 'Max Counter Bore Diameter', inputType: 'text', required: true },
        { key: 'box.maxCounterBoreLength', label: 'Max Counter Bore Length', inputType: 'text', required: true },
        { key: 'box.bevelDiameterMin', label: 'Bevel Diameter Min', inputType: 'text', required: true },
        { key: 'box.bevelDiameterMax', label: 'Bevel Diameter Max', inputType: 'text', required: true },
        { key: 'box.condition', label: 'Condition', inputType: 'text', required: true },
        { key: 'box.hardBanding', label: 'Hard Banding', inputType: 'text', required: true }
      ]
    },
    {
      key: 'pin',
      title: 'Pin Connection',
      fields: [
        { key: 'pin.minTongSpace', label: 'Min Tong Space', inputType: 'text', required: true },
        { key: 'pin.minOD', label: 'Min OD', inputType: 'text', required: true },
        { key: 'pin.maxID', label: 'Max ID', inputType: 'text', required: true },
        { key: 'pin.minEccShoulder', label: 'Min Ecc Shoulder', inputType: 'text', required: true },
        { key: 'pin.lengthPinConnMin', label: 'Length Pin Conn Min', inputType: 'text', required: true },
        { key: 'pin.lengthPinConnMax', label: 'Length Pin Conn Max', inputType: 'text', required: true },
        { key: 'pin.maxLengthPinBase', label: 'Max Length Pin Base', inputType: 'text', required: true },
        { key: 'pin.bevelDiameterMin', label: 'Bevel Diameter Min', inputType: 'text', required: true },
        { key: 'pin.bevelDiameterMax', label: 'Bevel Diameter Max', inputType: 'text', required: true },
        { key: 'pin.condition', label: 'Condition', inputType: 'text', required: true }
      ]
    },
    {
      key: 'body',
      title: 'Body',
      fields: [
        { key: 'body.wallRemaining', label: 'Wall Remaining', inputType: 'text', required: true },
        { key: 'body.odDecrease', label: 'OD Decrease', inputType: 'text', required: true },
        { key: 'body.emiResult', label: 'EMI Result', inputType: 'text', required: true },
        { key: 'body.slipArea', label: 'Slip Area', inputType: 'text', required: true },
        { key: 'body.corrosionIn', label: 'Corrosion Inside', inputType: 'boolean', required: true },
        { key: 'body.corrosionOut', label: 'Corrosion Outside', inputType: 'boolean', required: true },
        { key: 'body.ipc', label: 'IPC', inputType: 'boolean', required: true },
        { key: 'body.bentJoints', label: 'Bent Joints', inputType: 'boolean', required: true }
      ]
    },
    {
      key: 'final',
      title: 'Final Disposition',
      fields: [
        { key: 'final.isNew', label: 'Is New', inputType: 'boolean', required: true },
        { key: 'final.isPremium', label: 'Is Premium', inputType: 'boolean', required: true },
        { key: 'final.isC2', label: 'Is C2', inputType: 'boolean', required: true },
        { key: 'final.isScrap', label: 'Is Scrap', inputType: 'boolean', required: true },
        { key: 'final.disposition', label: 'Disposition', inputType: 'select', required: true, options: ['PASS', 'REWORK', 'SCRAP', 'HOLD'] }
      ]
    },
    {
      key: 'remarksSection',
      title: 'Additional Information',
      fields: [
        { key: 'remarks', label: 'Remarks', inputType: 'text', required: false }
      ]
    }
  ]
};
