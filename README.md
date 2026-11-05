# 打工能量站

一个给上班日补充一点能量的小页面，已接入项目首页 `/`。

- 按心情切换鼓励语，支持复制、收藏和查看收藏。
- 自定义上下班时间，显示倒计时；周末默认休息，暂不支持跨夜班次。
- 每日自我照顾清单、小确幸便签和 24 秒呼吸练习。
- 网页虚拟宠物「陪班小橘」：可拖动、收起、隐藏及召回，点小橘切换鼓励语。
- 参考实时工资卡片，展示今日收入、每秒计薪、有效工时、下班倒计时和本月估算。
- 适配手机和电脑，无需安装前端依赖，不使用外部图片或字体服务。

## macOS 桌面宠物

桌面版默认显示参考图样式的「上班鼓励器」：米白圆角工资卡片、逐位滚动的红色收入、工时进度、时薪、本月估算及参考兑换信息。窗口可以置顶，按住卡片标题或背景拖动即可移动；设置、退出等按钮保留点击功能。工资卡片、宠物、鼓励语和设置都打包在应用内，独立运行；不需要启动 Docker、Nginx 或 PHP，也不占用 `9501` 端口。

在 macOS 13 或更新版本、已安装 Xcode Command Line Tools 的 Mac 上，从项目目录构建：

```bash
bash desktop/macos/build.sh
```

构建产物为 `desktop/macos/build/WorkdayPet.app`，适用于当前 Mac 的处理器架构。双击打开应用，或在项目目录运行：

```bash
open desktop/macos/build/WorkdayPet.app
```

点击工资卡片的「设置」修改日薪、班次及午休。应用不显示 Dock 图标，可通过屏幕顶端菜单栏的爪印图标显示或隐藏窗口、切换「工资卡片」「宠物模式」、听鼓励语、开关置顶、重置位置或退出。宠物模式中可拖动小橘或顶栏，轻点小橘会切换鼓励语。

桌面设置中的上下班和午休时间均支持 **时:分:秒**，可直接输入 `08:30:15`、`23:59:59`，支持全选、复制、粘贴和 Tab 切换；输入 `8:30` 会在保存时补齐为 `08:30:00`。旧的分钟级设置继续使用，显示时自动补 `:00`，计薪和倒计时按设置的秒数计算。设置窗右上角 `×`、取消或 `Esc` 会关闭设置且不保存，`⌘W` 也可关闭当前设置。工资卡片右上角 `×`、桌面宠物顶栏 `×` 可直接退出应用；设置窗处于活动状态时也可按 `⌘Q` 退出。如只想临时隐藏，请用菜单栏的「隐藏小橘」。

桌面版将设置保存在本机，与浏览器网页中的设置分别保存。窗口位置会保留，下一次启动会恢复；隐藏宠物后也可从菜单栏召回。应用默认不配置登录时自动启动。修改 `public/` 下的前端代码后，重新构建并退出、打开应用即可更新打包资源。

原生自检可执行 `desktop/macos/build/WorkdayPet.app/Contents/MacOS/WorkdayPet --self-test`。添加 `--reference-preview --snapshot /绝对路径/preview.png` 可用参考图的测试参数导出应用自身视图，使用临时存储，不会修改实际工资设置。

时间编辑和关闭回归检查：`desktop/macos/build/WorkdayPet.app/Contents/MacOS/WorkdayPet --self-test --settings-test`，覆盖输入、保存、重新打开、非法时间校验、关闭设置及退出按钮桥接，使用临时存储。

原生拖动回归检查：`desktop/macos/build/WorkdayPet.app/Contents/MacOS/WorkdayPet --self-test --drag-test`，通过应用自己的原生鼠标事件视图验证窗口位移、按钮排除、松开结束和宠物轻点；检查仅移动隐藏测试窗口，不改变实际桌面位置或工资设置。

## 网页版

宠物陪伴页：**http://www.chatlocalhost.com/pet**。可以单独打开一个窄浏览器窗口使用；宠物在网页内悬浮，拖动顶栏或聚焦后按方向键可移动，按住 Shift 可加快移动。

点击收入卡片、宠物面板或倒计时上的「设置」，可以修改日薪、上下班时间、午休和每周工作日。首次使用的示例日薪为 200 元，上班时间为 09:00—18:00，午休为 12:00—13:30。午休不累计收入；到达下班时间后停止增长，非排班日不累计。

金额仅按设置估算。本月金额为「本月已过排班日按满勤补算 + 今日估算收入」，不包含请假、加班及税费；修改排班或日薪会重新计算。本地浏览器保存设置和宠物位置，不上传工资数据。

启动前先检查是否已有实例运行。服务运行时直接打开网页即可，不要重复执行 `start`：

```bash
curl --noproxy '*' -I http://www.chatlocalhost.com/pet
```

返回 `200 OK` 表示页面已可访问。若再次执行 `start` 出现 `Address already in use[98]` / `0.0.0.0:9501`，说明端口已有监听；需先确认并停止占用端口的旧实例，再重新启动。

仅在服务尚未运行时，选择前台或后台其中一种启动方式。当前 Docker 开发环境推荐从宿主机前台启动：

```bash
docker exec -it -w /var/www/html/chat php85 php -d swoole.use_shortname=Off bin/hyperf.php start
```

如果已经进入 `php85` 容器，则先切换到 `/var/www/html/chat`，再执行：

```bash
php -d swoole.use_shortname=Off bin/hyperf.php start
```

前台方式需要保持终端打开，按 `Ctrl+C` 停止该前台实例。不要同时使用下面的后台启动方式。

当前 Docker 开发环境的宿主机入口为 **http://www.chatlocalhost.com/**，访问链路为 `宿主机:80 → nginx → php85:9501`，无需额外映射容器的 `9501` 端口。直接在宿主机运行 Hyperf 时仍可访问 `http://localhost:9501/`。

首次使用，需要在宿主机 `/etc/hosts` 中添加：

```text
127.0.0.1 www.chatlocalhost.com
```

可在宿主机终端执行以下命令添加（需要管理员密码，已有该条目时不必重复添加）：

```bash
printf '\n127.0.0.1 www.chatlocalhost.com\n' | sudo tee -a /etc/hosts
```

或者，在确认 `php85` 容器中的 Hyperf 尚未运行后，从宿主机后台启动：

```bash
docker exec -d -w /var/www/html/chat php85 sh -c 'exec php -d swoole.use_shortname=Off bin/hyperf.php start > runtime/hyperf.log 2>&1'
```

服务日志位于 `runtime/hyperf.log`，可在宿主机用 `docker exec -w /var/www/html/chat php85 tail -n 50 runtime/hyperf.log` 查看。此命令不会配置容器启动项，容器重启后需重新启动 Hyperf。

Nginx 配置位于 `/Users/veigar/www/phpdev/nginx/conf.d/default.conf`，`www.chatlocalhost.com` 的请求通过 HTTP 反向代理到 `http://php85:9501`。修改配置后，在宿主机检查并平滑重载：

```bash
docker exec nginx nginx -t
docker exec nginx nginx -s reload
```

页面文件位于 `public/`；`assets/salary-core.js` 负责工资计算，`assets/pet.js` 和 `assets/pet.css` 负责宠物与收入卡片。路由位于 `config/routes.php`，由 `IndexController` 返回页面和静态资源；无需修改 `runtime/container/proxy/` 下自动生成的文件。修改 PHP 后需先停止旧实例，再启动 Hyperf，不能直接额外运行一次 `start`。修改 HTML、CSS、JS 后刷新页面即可。

工资计算检查无需前端依赖，可在宿主机执行 `node --test test/frontend/salary-core.test.js`。

收藏、班次和每日记录仅保存在当前浏览器；清空浏览器站点数据会移除这些记录。清单、便签和充电次数按本地日期在每天零点重置，收藏和班次保留。

以下保留 Hyperf 框架的原始说明。

# Introduction

This is a skeleton application using the Hyperf framework. This application is meant to be used as a starting place for those looking to get their feet wet with Hyperf Framework.

# Requirements

Hyperf has some requirements for the system environment, it can only run under Linux and Mac environment, but due to the development of Docker virtualization technology, Docker for Windows can also be used as the running environment under Windows.

The various versions of Dockerfile have been prepared for you in the [hyperf/hyperf-docker](https://github.com/hyperf/hyperf-docker) project, or directly based on the already built [hyperf/hyperf](https://hub.docker.com/r/hyperf/hyperf) Image to run.

When you don't want to use Docker as the basis for your running environment, you need to make sure that your operating environment meets the following requirements:  

 - PHP >= 8.2
 - Any of the following network engines
   - Swoole PHP extension >= 5.0，with `swoole.use_shortname` set to `Off` in your `php.ini`
   - Swow PHP extension >= 1.3
 - JSON PHP extension
 - Pcntl PHP extension
 - OpenSSL PHP extension （If you need to use the HTTPS）
 - PDO PHP extension （If you need to use the MySQL Client）
 - Redis PHP extension （If you need to use the Redis Client）
 - Protobuf PHP extension （If you need to use the gRPC Server or Client）

# Installation using Composer

The easiest way to create a new Hyperf project is to use [Composer](https://getcomposer.org/). If you don't have it already installed, then please install as per [the documentation](https://getcomposer.org/download/).

To create your new Hyperf project:

```bash
composer create-project hyperf/hyperf-skeleton path/to/install
```

If your development environment is based on Docker you can use the official Composer image to create a new Hyperf project:

```bash
docker run --rm -it -v $(pwd):/app composer create-project --ignore-platform-reqs hyperf/hyperf-skeleton path/to/install
```

# Getting started

Once installed, you can run the server immediately using the command below.

```bash
cd path/to/install
php bin/hyperf.php start
```

Or if in a Docker based environment you can use the `docker-compose.yml` provided by the template:

```bash
cd path/to/install
docker-compose up
```

This will start the cli-server on port `9501`, and bind it to all network interfaces. You can then visit the site at `http://localhost:9501/` which will bring up Hyperf default home page.

## Hints

- A nice tip is to rename `hyperf-skeleton` of files like `composer.json` and `docker-compose.yml` to your actual project name.
- Take a look at `config/routes.php` and `app/Controller/IndexController.php` to see an example of a HTTP entrypoint.

**Remember:** you can always replace the contents of this README.md file to something that fits your project description.
