# 独立公网部署

本目录只部署`N16R8 无摄像头家庭情境侦探屋`，固定运行目录`/home/ubuntu/smartlife-context-detective`，服务名`smartlife-context-*`，内部端口`19466/19467/19468/19483`。不得停止、覆盖或重启现有`smartlife-junior-*`、`smartlife-primary-*`和`smartlife-primary-hk2-*`。

## 检查点与安装

1. 保存`systemctl`、`ss -ltnp`、`nginx -T`和现有站点HTTP状态快照。
2. 备份目标目录与本项目Nginx站点；首次部署时记录目标不存在。
3. 将已推送仓库检出到目标目录，建立`.venv`并安装`tools/requirements.txt`。
4. 从`.env.example`生成`deploy/.env`，权限`600`。真实讯飞值只在服务器内写入，不进入Git、浏览器或日志。
5. 复制四个本项目systemd单元，`daemon-reload`后先不要启动。

## 两阶段HTTPS

1. 把`__DOMAIN__`替换为实际独立域名，先安装HTTP模板。
2. 运行`nginx -t`后reload；用Certbot webroot取得独立证书。
3. 再安装HTTPS模板，每次仍先`nginx -t`后reload。
4. 启动`smartlife-context-mqtt/web/relay/voice`，不重启其他项目。

## 验证

- 四个新服务均为active，且只监听`127.0.0.1:194xx`。
- `GET /api/voice/health`不包含任何凭据。
- 公网静态文件与本地SHA-256一致，WSS返回101，Relay上报MQTT已连接。
- 两个浏览器完成显式Mock板帧、远程命令、同ID ACK和后续遥测闭环。
- 部署前后原有SmartLife服务PID/active状态和公网HTTP状态不变。

## 回滚

只停止并禁用`smartlife-context-*`，移除本项目Nginx软链接，恢复本项目带时间戳备份；`nginx -t`通过后reload。保留目标目录用于诊断，不删除或修改其他项目目录、服务、MQTT配置或证书。
