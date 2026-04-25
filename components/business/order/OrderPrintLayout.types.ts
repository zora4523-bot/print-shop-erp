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
  fileName: string;
  thumbnailUrl?: string | null;
  uploadedAt: Date;
};

export type PrintTask = {
  id: string;
  craftName: string;
  workerDisplayName?: string | null;
  // Pre-rendered QR code SVG (from `qrcode` server package). Server-
  // side pre-render avoids the &ldquo;two React copies&rdquo; hook bug that
  // qrcode.react triggers when renderToStaticMarkup dynamically pulls
  // in react-dom/server (Next 16 / Turbopack guard forces dynamic
  // import; that loads its own React vs the bundled one). String SVG
  // sidesteps the entire hook ecosystem.
  qrSvg: string;
};

export type PrintOrderItem = {
  id: string;
  sequence: number;
  name: string;
  specification?: string | null;
  paperType?: string | null;
  quantity: number;
  foilColor?: string | null;
  isDoubleSided: boolean;
  isDoubleColor: boolean;
  craftNames: string[];
  remark?: string | null;
  designs: PrintDesign[];
  tasks: PrintTask[];
};

export type PrintOrder = {
  id: string;
  orderNo: string;
  isUrgent: boolean;
  customerRef?: string | null;
  receiverName?: string | null;
  receiverPhone?: string | null;
  receiverAddress?: string | null;
  expressCode?: string | null;
  packageRequirement?: string | null;
  remark?: string | null;
  submittedAt?: Date | null;
  createdAt: Date;
  submitterDisplayName: string;
  // Pre-resolved Chinese label ("销售" / "客服") so the component
  // doesn't need to import auth/role-labels and stays role-agnostic.
  submitterRoleLabel: string;
  items: PrintOrderItem[];
  // Same rationale as PrintTask.qrSvg — pre-rendered to avoid the
  // qrcode.react / hooks bug under renderToStaticMarkup.
  orderQrSvg: string;
};
