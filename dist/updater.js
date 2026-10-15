"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExtensionUpdater = void 0;
const vscode = require("vscode");
const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
class ExtensionUpdater {
    static GITHUB_REPO = 'mquand/Claude-Session-Manager-';
    static async checkForUpdates(context, manual = false) {
        const currentVersion = context.extension.packageJSON.version || '0.0.0';
        try {
            const release = await this.getLatestRelease();
            if (!release || !release.tag_name) {
                if (manual) {
                    vscode.window.showInformationMessage('Không tìm thấy thông tin bản phát hành trên GitHub.');
                }
                return;
            }
            const latestVersion = release.tag_name.replace(/^v/, '');
            const isNewer = this.compareSemver(latestVersion, currentVersion) > 0;
            if (!isNewer) {
                if (manual) {
                    vscode.window.showInformationMessage(`Bạn đang sử dụng phiên bản mới nhất (v${currentVersion}).`);
                }
                return;
            }
            const vsixAsset = release.assets?.find((a) => a.name && a.name.endsWith('.vsix'));
            if (!vsixAsset) {
                if (manual) {
                    vscode.window.showWarningMessage(`Đã có phiên bản mới v${latestVersion} trên GitHub nhưng chưa có file cài đặt .vsix đính kèm.`, 'Xem GitHub').then(choice => {
                        if (choice === 'Xem GitHub') {
                            vscode.env.openExternal(vscode.Uri.parse(release.html_url));
                        }
                    });
                }
                return;
            }
            const choice = await vscode.window.showInformationMessage(`Đã có bản cập nhật mới v${latestVersion} cho Claude Session Manager! (Hiện tại: v${currentVersion})`, 'Cập nhật ngay', 'Xem chi tiết', 'Để sau');
            if (choice === 'Xem chi tiết') {
                vscode.env.openExternal(vscode.Uri.parse(release.html_url));
            }
            else if (choice === 'Cập nhật ngay') {
                await this.performUpdate(vsixAsset.browser_download_url, vsixAsset.name, latestVersion);
            }
        }
        catch (err) {
            if (manual) {
                vscode.window.showErrorMessage(`Kiểm tra cập nhật thất bại: ${err?.message || err}`);
            }
        }
    }
    static async performUpdate(downloadUrl, fileName, targetVersion) {
        const tempDir = os.tmpdir();
        const destPath = path.join(tempDir, fileName);
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Đang cập nhật Claude Session Manager lên v${targetVersion}...`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Đang tải file cài đặt từ GitHub...' });
            await this.downloadWithRedirects(downloadUrl, destPath);
            progress.report({ increment: 60, message: 'Đang tiến hành cài đặt...' });
            try {
                const vsixUri = vscode.Uri.file(destPath);
                await vscode.commands.executeCommand('workbench.extensions.installExtension', vsixUri);
                progress.report({ increment: 100, message: 'Hoàn tất cài đặt!' });
                const reloadChoice = await vscode.window.showInformationMessage(`Đã cập nhật thành công lên v${targetVersion}! Vui lòng tải lại cửa sổ để áp dụng.`, 'Khởi động lại ngay');
                if (reloadChoice === 'Khởi động lại ngay') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            }
            finally {
                try {
                    if (fs.existsSync(destPath)) {
                        fs.unlinkSync(destPath);
                    }
                }
                catch { }
            }
        });
    }
    static getLatestRelease() {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${this.GITHUB_REPO}/releases/latest`,
                headers: {
                    'User-Agent': 'VSCode-Claude-Session-Manager',
                    'Accept': 'application/vnd.github.v3+json'
                }
            };
            https.get(options, (res) => {
                if (res.statusCode === 404) {
                    return resolve(null);
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`GitHub API HTTP ${res.statusCode}`));
                }
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            }).on('error', reject);
        });
    }
    static downloadWithRedirects(url, destPath, maxRedirects = 5) {
        return new Promise((resolve, reject) => {
            if (maxRedirects <= 0) {
                return reject(new Error('Quá nhiều lần chuyển hướng'));
            }
            const client = url.startsWith('https:') ? https : http;
            client.get(url, { headers: { 'User-Agent': 'VSCode-Claude-Session-Manager' } }, (res) => {
                if (res.statusCode && [301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
                    return resolve(this.downloadWithRedirects(res.headers.location, destPath, maxRedirects - 1));
                }
                if (res.statusCode !== 200) {
                    return reject(new Error(`Tải file thất bại (HTTP ${res.statusCode})`));
                }
                const fileStream = fs.createWriteStream(destPath);
                res.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
                fileStream.on('error', (err) => {
                    fs.unlink(destPath, () => { });
                    reject(err);
                });
            }).on('error', reject);
        });
    }
    static compareSemver(v1, v2) {
        const p1 = v1.split('.').map(n => parseInt(n, 10) || 0);
        const p2 = v2.split('.').map(n => parseInt(n, 10) || 0);
        const len = Math.max(p1.length, p2.length);
        for (let i = 0; i < len; i++) {
            const num1 = p1[i] || 0;
            const num2 = p2[i] || 0;
            if (num1 > num2)
                return 1;
            if (num1 < num2)
                return -1;
        }
        return 0;
    }
}
exports.ExtensionUpdater = ExtensionUpdater;
//# sourceMappingURL=updater.js.map