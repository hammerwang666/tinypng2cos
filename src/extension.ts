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

async function readFile() {
  const fileUrl = await vscode.window.showOpenDialog({
    canSelectFolders: false,
    canSelectMany: false,
    filters: {
      images: ['png', 'jpg', 'jpeg', 'gif', 'webp'],
    },
  });
  if (!fileUrl) return;
  const fileUrL = fileUrl![0].path.slice(1);
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

async function registerCos() {
  // @ts-ignore
  const { fileUrL, extName } = await readFile();
  // 读取用户设置
  const userConfig = vscode.workspace.getConfiguration('upload_image');
  // tinyPNG压缩，支持PNG JPEG
  const { bucket, region, secretId, secretKey, folder, tinifyKey, cdnHost } = userConfig;

  fs.readFile(fileUrL, async (err: any, data: any) => {
    if (err) throw err;
    let imageBuffer = data;
    if (['png', 'jpg', 'jpeg'].includes(extName)) {
      imageBuffer = await tinyCompress(tinifyKey, data);
    }
    // 上传COS
    const cos = new COS({
      SecretId: secretId,
      SecretKey: secretKey,
    });
    const cosFileKey = `${folder}/${getFileName()}.${extName}`;
    cos.putObject(
      {
        Bucket: bucket,
        Region: region,
        Key: cosFileKey,
        Body: imageBuffer, // 上传文件对象
        onProgress: function (progressData: any) {
          console.log(JSON.stringify(progressData));
        },
      },
      function (err: any, data: any) {
        if (err) throw err;
        console.log('cdnHost!!!!!', cdnHost);
        addUrlToEditor(cdnHost ? `${cdnHost}/${cosFileKey}` : `https://${data.Location}`);
      },
    );
  });
}

async function registerOss() {
  //@ts-ignore
  const { fileUrL, extName } = await readFile();
  // 读取用户设置
  const userConfig = vscode.workspace.getConfiguration('upload_image');
  // tinyPNG压缩，支持PNG JPEG
  const {
    bucketOss,
    regionOss,
    accessKeyId,
    accessKeySecret,
    folderOss,
    tinifyKeyOss,
    cdnHostOss,
  } = userConfig;

  fs.readFile(fileUrL, async (err: any, data: any) => {
    if (err) throw err;
    let imageBuffer = data;
    if (['png', 'jpg', 'jpeg'].includes(extName)) {
      imageBuffer = await tinyCompress(tinifyKeyOss, data);
    }

    const options = {
      // yourRegion填写Bucket所在地域。以华东1（杭州）为例，Region填写为oss-cn-hangzhou。
      region: regionOss,
      // 阿里云账号AccessKey拥有所有API的访问权限，风险很高。强烈建议您创建并使用RAM用户进行API访问或日常运维，请登录RAM控制台创建RAM用户。
      accessKeyId: accessKeyId,
      accessKeySecret: accessKeySecret,
      bucket: bucketOss,
    };
    console.log('options!!!!!!!', options);
    try {
      const client = new OSS(options);

      const cosFileKey = `${folderOss}/${getFileName()}.${extName}`;
      const res = await client.put(cosFileKey, fileUrL);
      console.log('res!!!!!!!!', res);
      addUrlToEditor(
        cdnHostOss ? `${cdnHostOss}/${cosFileKey}` : `${res.url.replace('http:', 'https:')}`,
      );
    } catch (error) {
      console.log('error', error);
    }
  });
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  const texteditorCos = vscode.commands.registerTextEditorCommand(
    'extension.tinypng2cos',
    registerCos,
  );
  context.subscriptions.push(texteditorCos);
  const texteditorOss = vscode.commands.registerTextEditorCommand(
    'extension.tinypng2oss',
    registerOss,
  );
  context.subscriptions.push(texteditorOss);
}

// this method is called when your extension is deactivated
export function deactivate() {}
