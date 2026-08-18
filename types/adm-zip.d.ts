declare module 'adm-zip' {
  export interface AdmZipEntry {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  }
  export default class AdmZip {
    constructor(path?: string | Buffer);
    addLocalFile(localPath: string, zipPath?: string, zipName?: string): void;
    addLocalFolder(localPath: string, zipPath?: string): void;
    getEntries(): AdmZipEntry[];
    writeZip(targetPath: string): void;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
  }
}
