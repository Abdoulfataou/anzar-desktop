/** Type declarations for packages without @types */

declare module 'html2pdf.js' {
  interface Html2PdfOptions {
    margin?: number | number[];
    filename?: string;
    image?: { type?: string; quality?: number };
    html2canvas?: Record<string, any>;
    jsPDF?: { unit?: string; format?: string; orientation?: string };
  }
  interface Html2PdfInstance {
    set(options: Html2PdfOptions): Html2PdfInstance;
    from(element: HTMLElement | string): Html2PdfInstance;
    outputPdf(type: 'blob'): Promise<Blob>;
    outputPdf(type: 'datauristring'): Promise<string>;
    save(): Promise<void>;
  }
  function html2pdf(): Html2PdfInstance;
  export default html2pdf;
}

declare module 'file-saver' {
  export function saveAs(blob: Blob, filename: string): void;
}
