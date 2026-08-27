// Narrow view-model the print layout actually needs. We flatten the
// DB joins into plain fields so:
//   1. The server page can resolve craft IDs → names once (instead of
//      carrying the whole Craft dictionary into a client bundle).
//   2. Tests can build fixtures without touching Prisma types.
//   3. The same shape can be serialized for Puppeteer's page.evaluate
//      hand-off later if we ever render server-side.

export type PrintDesign = {
  id: string;
  fileType: 'IMAGE' | 'CDR';
  fileUrl: string;
};

export type PrintTask = {
  id: string;
  craftName: string;
  workerDisplayName?: string | null;
  plannedQty: number;
  completedQty: number;
  defectQty: number;
  completedAt?: Date | null;
};

export type PrintShipment = {
  id: string;
  sequence: number;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  expressCode?: string | null;
  carrierCode?: string | null;
  trackingNo?: string | null;
  lines: Array<{
    orderItemSequence: number;
    orderItemName: string;
    quantity: number;
  }>;
};

export type PrintOrderItem = {
  id: string;
  sequence: number;
  name: string;
  pricingRoute:
    | 'STOCK_BLANK'
    | 'CUSTOM_SINGLE_FLAT_FOIL'
    | 'COLOR_PRINT'
    | 'MANUAL_QUOTE';
  artworkVersion?: string | null;
  specification?: string | null;
  paperType?: string | null;
  paperWeightGsm?: number | null;
  quantity: number;
  frontFoilColors: string[];
  backFoilColors: string[];
  foilColors: string[];
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  craftNames: string[];
  remark?: string | null;
  designs: PrintDesign[];
  tasks: PrintTask[];
};

export type PrintPackagingGroup = {
  id: string;
  sequence: number;
  name?: string | null;
  mode: 'SINGLE_STYLE' | 'MIXED_STYLE';
  actualBagCount: number;
  lines: Array<{
    orderItemId: string;
    orderItemSequence: number;
    unitsPerBag: number;
  }>;
};

export type PrintOrder = {
  id: string;
  orderNo: string;
  customName?: string | null;
  kind: 'NORMAL' | 'REWORK';
  sourceOrderNo?: string | null;
  isUrgent: boolean;
  isSfCollect: boolean;
  promisedDate?: Date | null;
  customerName?: string | null;
  customerRef?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  expressCode?: string | null;
  packageRequirement?: string | null;
  remark?: string | null;
  submittedAt?: Date | null;
  createdAt: Date;
  items: PrintOrderItem[];
  packagingGroups: PrintPackagingGroup[];
  shipments: PrintShipment[];
  // Pre-rendered so the browser print view and renderToStaticMarkup PDF
  // consume the exact same QR SVG without a client-only QR dependency.
  orderQrSvg: string;
};
