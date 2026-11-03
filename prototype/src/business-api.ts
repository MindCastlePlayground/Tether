import { z } from 'zod';
import { BusinessMethod as M } from './business.js';

export class BusinessApi {
  static readonly PopupCandidates='popupCandidates';
  static readonly AdoptPopup='adoptPopup';
  static readonly Names=[...Object.values(M).filter((v):v is string=>typeof v==='string'),BusinessApi.PopupCandidates,BusinessApi.AdoptPopup];
  static readonly Page={sessionId:z.string().min(1),pageId:z.string().min(1)};
  static readonly Write={...BusinessApi.Page,seq:z.number().int().positive()};
  static readonly Descriptions:Record<string,[string,string]>={
    [M.UploadStart]:['Begin a file upload. Returns uploadId and maximum raw chunkBytes.','开始文件上传，返回 uploadId 和每块原始字节上限 chunkBytes。'],
    [M.UploadChunk]:['Append base64 data at the exact byte offset; use the returned nextOffset.','按字节偏移追加 base64 数据，下一块使用返回的 nextOffset。'],
    [M.UploadFinish]:['Apply staged files to one file input. OOPIF selector: frame=iframe-selector >> input-selector.','将暂存文件写入唯一文件输入框；跨进程 iframe 选择器：frame=iframe-selector >> input-selector。'],
    [M.UploadDrop]:['Discard a staged upload.','清除暂存上传。'],
    [M.DownloadStart]:['Fetch a same-origin HTTP GET file using page credentials; returns downloadId.','使用页面登录态发起同源 HTTP GET 下载，返回 downloadId。'],
    [M.DownloadRead]:['Read one base64 chunk at the exact byte offset until done; use nextOffset.','按字节偏移读取 base64 分块，使用 nextOffset 继续，直到 done。'],
    [M.DownloadDrop]:['Cancel and release a download stream.','取消并释放下载流。'],
    [M.Dialog]:['List, accept or dismiss JavaScript dialogs. Choose dialogId from list; promptText answers prompts.','列出、接受或关闭 JavaScript 对话框；dialogId 从 list 获取，promptText 用于 prompt 输入。'],
    [BusinessApi.PopupCandidates]:['List HTTP(S) popups opened by this session. Discovery does not grant control.','列出当前会话页面打开的 HTTP(S) 弹窗，发现后需显式接管。'],
    [BusinessApi.AdoptPopup]:['Adopt one candidate popup into this session using its tabId and openerPageId.','使用候选弹窗的 tabId 和 openerPageId 将其接管到当前会话。'],
  };
  static readonly Schemas:Record<string,z.ZodType>={
    [BusinessApi.PopupCandidates]:z.object({sessionId:z.string().min(1)}).strict(),
    [BusinessApi.AdoptPopup]:z.object({sessionId:z.string().min(1),seq:z.number().int().positive(),openerPageId:z.string().min(1),tabId:z.number().int().nonnegative()}).strict(),
    [M.UploadStart]:z.object({...BusinessApi.Write,files:z.array(z.object({name:z.string().min(1).max(180),mimeType:z.string().max(120).optional(),size:z.number().int().min(0).max(16777216)}).strict()).min(1).max(8)}).strict(),
    [M.UploadChunk]:z.object({...BusinessApi.Write,uploadId:z.string(),fileIndex:z.number().int().min(0).max(7),offset:z.number().int().nonnegative(),data:z.string().max(32768)}).strict(),
    [M.UploadFinish]:z.object({...BusinessApi.Write,uploadId:z.string(),selector:z.string().min(1).max(2000)}).strict(),
    [M.UploadDrop]:z.object({...BusinessApi.Write,uploadId:z.string()}).strict(),
    [M.DownloadStart]:z.object({...BusinessApi.Write,url:z.string().min(1).max(4096)}).strict(),
    [M.DownloadRead]:z.object({...BusinessApi.Write,downloadId:z.string(),offset:z.number().int().nonnegative()}).strict(),
    [M.DownloadDrop]:z.object({...BusinessApi.Write,downloadId:z.string()}).strict(),
    [M.Dialog]:z.object({...BusinessApi.Write,action:z.enum(['list','accept','dismiss']),dialogId:z.string().optional(),promptText:z.string().max(2000).optional()}).strict(),
  };
  static valid(method:string,params:unknown):void {if(!BusinessApi.Schemas[method]?.safeParse(params).success)throw Error('invalid_params');}
}
