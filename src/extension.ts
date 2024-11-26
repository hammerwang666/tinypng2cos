// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import tinify from 'tinify';
import * as fs from 'fs';
import * as COS from 'cos-nodejs-sdk-v5';
import * as OSS from 'ali-oss';

// tinyPNG压缩
function tinyCompress(tinifyKey: string, sourceData: Buffer) {
  return new Promise((resolve, reject) => {
    tinify.key = tinifyKey;
    tinify.fromBuffer(sourceData).toBuffer(function (err: any, data: any) {
      if (data) {
        resolve(data);
      }
      if (err) {
        reject(err);
      }
    });
  });
}

// URL插入编辑器
function addUrlToEditor(url: string) {
  let editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }
  const { start, end, active } = editor.selection;
  if (start.line === end.line && start.character === end.character) {
    // 光标位置插入内容
    const activePosition = active;
    editor.edit((editBuilder) => {
      editBuilder.insert(activePosition, url);
    });
  } else {
    // 替换选中内容
    const selection = editor.selection;
    editor.edit((editBuilder) => {
      editBuilder.replace(selection, url);
    });
  }
}

// 修改常量名以更好地表达其用途
const WORKSPACE_UPLOAD_PATH_KEY = 'workspaceUploadPath';

// 修改 readFile 函数，使用 workspaceState
async function readFile(context: vscode.ExtensionContext) {
  // 获取当前工作空间的上次路径
  const lastPath = context.workspaceState.get<string>(WORKSPACE_UPLOAD_PATH_KEY);

  const fileUrl = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectMany: false,
    // 如果有上次的路径，则使用该路径作为默认路径
    defaultUri: lastPath ? vscode.Uri.file(lastPath) : undefined,
    filters: {
      images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    },
  });

  if (!fileUrl) { return; }

  // 保存这次选择的路径到当前工作空间
  const selectedPath = fileUrl[0].fsPath;
  const directoryPath = selectedPath.substring(0, selectedPath.lastIndexOf('/'));
  await context.workspaceState.update(WORKSPACE_UPLOAD_PATH_KEY, directoryPath);

  const fileUrL = fileUrl[0].path.slice(1);
  const extName = fileUrL.split(/\.(gif|png|jpg|jpeg|webp)$/i)[1];
  return {
    fileUrL,
    extName,
  };
}

// 生成文件名
function getFileName() {
  const newDate = new Date();
  const timeStamp = newDate.getTime();
  const month = newDate.getMonth() + 1;
  const date = newDate.getDate();
  return `${month}-${date}-${timeStamp}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(2)}KB`;
  } else {
    return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
  }
}

// 在文件顶部添加一个工具函数
function showTemporaryMessage(message: string, timeout: number = 3000) {
  const disposable = vscode.window.setStatusBarMessage(message, timeout);
  return disposable;
}

// 修改 registerCos 函数，添加 context 参数
async function registerCos(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, context: vscode.ExtensionContext) {
  try {
    showTemporaryMessage('Please select an image file...');
    const result = await readFile(context);
    if (!result) {
      return;
    }

    // 读取用户设置
    const userConfig = vscode.workspace.getConfiguration('upload_image');
    const { bucket, region, secretId, secretKey, folder, tinifyKey, cdnHost } = userConfig;

    fs.readFile(result.fileUrL, async (err: any, data: any) => {
      if (err) { throw err; }

      let imageBuffer = data;
      if (['png', 'jpg', 'jpeg'].includes(result.extName)) {
        showTemporaryMessage('Compressing image with TinyPNG...');
        imageBuffer = await tinyCompress(tinifyKey, data);
      }

      // 创建进度显示
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uploading ${result.extName.toUpperCase()} image to COS...`,
        cancellable: false
      }, async (progress) => {
        return new Promise((resolve, reject) => {
          const cos = new COS({
            SecretId: secretId,
            SecretKey: secretKey,
          });

          const cosFileKey = `${folder}/${getFileName()}.${result.extName}`;
          const fileName = `${getFileName()}.${result.extName}`;

          cos.putObject(
            {
              Bucket: bucket,
              Region: region,
              Key: cosFileKey,
              Body: imageBuffer,
              onProgress: function (progressData) {
                const percent = Math.round(progressData.percent * 100);
                const loaded = formatFileSize(progressData.loaded);
                const total = formatFileSize(progressData.total);
                progress.report({
                  message: `${fileName} | ${percent}% uploaded (${loaded} / ${total})`,
                  increment: percent
                });
              },
            },
            function (err: any, data: any) {
              if (err) {
                vscode.window.showErrorMessage(`Upload failed: ${err.message}`);
                reject(err);
                return;
              }

              const finalUrl = cdnHost ? `${cdnHost}/${cosFileKey}` : `https://${data.Location}`;
              addUrlToEditor(finalUrl);
              showTemporaryMessage(`Upload completed! File: ${fileName}`);
              resolve(data);
            },
          );
        });
      });
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Operation failed: ${error}`);
  }
}

// 修改 registerOss 函数，添加 context 参数
async function registerOss(textEditor: vscode.TextEditor, edit: vscode.TextEditorEdit, context: vscode.ExtensionContext) {
  try {
    showTemporaryMessage('Please select an image file...');
    const result = await readFile(context);
    if (!result) {
      return;
    }

    // 读取用户设置
    const userConfig = vscode.workspace.getConfiguration('upload_image');
    const {
      bucketOss,
      regionOss,
      accessKeyId,
      accessKeySecret,
      folderOss,
      tinifyKeyOss,
      cdnHostOss,
    } = userConfig;

    fs.readFile(result.fileUrL, async (err: any, data: any) => {
      if (err) { throw err; }

      let imageBuffer = data;
      if (['png', 'jpg', 'jpeg'].includes(result.extName)) {
        showTemporaryMessage('Compressing image with TinyPNG...');
        imageBuffer = await tinyCompress(tinifyKeyOss, data);
      }

      const options = {
        region: regionOss,
        accessKeyId: accessKeyId,
        accessKeySecret: accessKeySecret,
        bucket: bucketOss,
      };

      // 创建进度显示
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `Uploading ${result.extName.toUpperCase()} image to OSS...`,
        cancellable: false
      }, async (progress) => {
        return new Promise((resolve, reject) => {
          try {
            const client = new OSS(options);
            const cosFileKey = `${folderOss}/${getFileName()}.${result.extName}`;
            const fileSize = formatFileSize(data.length);

            // 更新进度显示
            client.put(cosFileKey, result.fileUrL, {
              progress: (p: number) => {
                const percent = Math.round(p * 100);
                progress.report({
                  message: `Size: ${fileSize} | ${percent}% uploaded | ${getFileName()}.${result.extName}`,
                  increment: percent
                });
              }
            }).then(res => {
              const finalUrl = cdnHostOss
                ? `${cdnHostOss}/${cosFileKey}`
                : `${res.url.replace('http:', 'https:')}`;

              addUrlToEditor(finalUrl);
              showTemporaryMessage(`Upload successful! File size: ${fileSize}`);
              resolve(res);
            }).catch(err => {
              vscode.window.showErrorMessage(`Upload failed: ${err.message}`);
              reject(err);
            });

          } catch (error) {
            vscode.window.showErrorMessage(`Upload failed: ${error}`);
            reject(error);
          }
        });
      });
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Operation failed: ${error}`);
  }
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const texteditorCos = vscode.commands.registerTextEditorCommand(
    'extension.tinypng2cos',
    (textEditor, edit) => registerCos(textEditor, edit, context),
  );
  context.subscriptions.push(texteditorCos);

  const texteditorOss = vscode.commands.registerTextEditorCommand(
    'extension.tinypng2oss',
    (textEditor, edit) => registerOss(textEditor, edit, context),
  );
  context.subscriptions.push(texteditorOss);
}

// this method is called when your extension is deactivated
export function deactivate() { }
