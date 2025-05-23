const util = require('util');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function addImageAddrJob(imageAddrInfo) {
  let encodedCredentials = '';
  if (imageAddrInfo.username && imageAddrInfo.passwd) {
    encodedCredentials = Buffer.from(`${imageAddrInfo.username}:${imageAddrInfo.passwd}`).toString('base64');
  }
  //这里可以直接获取host.yaml文件，因为前提条件集群已经部署了
  let currentDir = process.cwd();
  // 使用相对路径
  let inventoryPath = path.join(currentDir, '/data/inventory', `inventory-${imageAddrInfo.clusterId}`);
  if (!fs.existsSync(inventoryPath)) {
    fs.mkdirSync(inventoryPath, { recursive: true });
  }
  const inventoryHostsPath = path.join(inventoryPath, 'hosts.yaml');
  let privateKeyPath = path.join(currentDir, '/ssh/id_rsa');
  try {
    let workDir = `${currentDir}/registry_config`
    const options = { cwd: workDir };
    for (const item of imageAddrInfo.hosts) {
      const ansibleCommand = `ansible-playbook -i ${inventoryHostsPath} add.yml -e server=${imageAddrInfo.imageAddr}` +
        (encodedCredentials ? ` -e admin_passwd=${encodedCredentials}` : '') +
        ` -e registry_host_ip=${imageAddrInfo.registryIP} --private-key ${privateKeyPath} --limit ${item.hostName}`;
      await new Promise((resolve, reject) => {
        exec(ansibleCommand, options, (error, stdout, stderr) => {
          if (error) {
            //console.log("config文件不存在")
            return reject(`执行命令时出错: ${error.message}`);
          }
          if (stderr) {
            console.error(`错误输出: ${stderr}`);
          }
          resolve();
        });
      });
    }

  } catch (error) {
    console.error('添加镜像仓库任务到队列时发生错误:', error.message || error);
    return {
      code: 50000,
      msg: '添加镜像仓库任务失败',
      status: "error"
    };
  }
  return {
    code: 20000,
    data: '',
    msg: "添加镜像仓库成功",
    status: "ok"
  };
}


async function removeImageAddrJob(imageAddrInfo) {
  //这里可以直接获取host.yaml文件，因为前提条件集群已经部署了
  let currentDir = process.cwd();
  // 使用相对路径
  let inventoryPath = path.join(currentDir, '/data/inventory', `inventory-${imageAddrInfo.clusterId}`);
  if (!fs.existsSync(inventoryPath)) {
    fs.mkdirSync(inventoryPath, { recursive: true });
  }
  const inventoryHostsPath = path.join(inventoryPath, 'hosts.yaml');
  let privateKeyPath = path.join(currentDir, '/ssh/id_rsa');
  try {
    let workDir = `${currentDir}/registry_config`
    const options = { cwd: workDir };
    for (const item of imageAddrInfo.hosts) {
      //ansible-playbook -i inventory_path delete.yml -e server=https://core.harbor.k8s.ebupt.com
      const ansibleCommand = `ansible-playbook -i ${inventoryHostsPath} delete.yml -e server=${imageAddrInfo.imageAddr} --private-key ${privateKeyPath} --limit ${item.hostName}`;
      await new Promise((resolve, reject) => {
        exec(ansibleCommand, options, (error, stdout, stderr) => {
          if (error) {
            //console.log("config文件不存在")
            return reject(`执行命令时出错: ${error.message}`);
          }
          if (stderr) {
            console.error(`错误输出: ${stderr}`);
          }
          resolve();
        });
      });
    }

  } catch (error) {
    console.error('删除镜像仓库时发生错误:', error.message || error);
    return {
      code: 50000,
      msg: '删除镜像仓库失败',
      status: "error"
    };
  }
  return {
    code: 20000,
    data: '',
    msg: "镜像地址成功",
    status: "ok"
  };
}

// 辅助函数：解析 TOML 内容
function parseToml(tomlContent) {
  // 在这里实现 TOML 解析逻辑
  // 可以使用 `toml` 库来解析内容
  return require('toml').parse(tomlContent);
}

async function getImageAddrJob(id) {
  //ansible-playbook -i inventory_path query.yml
  //这里可以直接获取host.yaml文件，因为前提条件集群已经部署了
  let currentDir = process.cwd();
  // 使用相对路径
  let inventoryPath = path.join(currentDir, '/data/inventory', `inventory-${id}`);
  if (!fs.existsSync(inventoryPath)) {
    fs.mkdirSync(inventoryPath, { recursive: true });
  }
  const inventoryHostsPath = path.join(inventoryPath, 'hosts.yaml');
  let privateKeyPath = path.join(currentDir, '/ssh/id_rsa');
  try {
    let workDir = `${currentDir}/registry_config`
    const options = { cwd: workDir };
    const ansibleCommand = `ansible-playbook -i ${inventoryHostsPath} query.yml --private-key ${privateKeyPath}`;
    await new Promise((resolve, reject) => {
      exec(ansibleCommand, options, (error, stdout, stderr) => {
        if (error) {
          //console.log("config文件不存在")
          return reject(`执行命令时出错: ${error.message}`);
        }
        if (stderr) {
          console.error(`错误输出: ${stderr}`);
        }
        //console.log(stdout)
        resolve();
      });
    });


    // 新代码：读取并解析 .toml 文件
    const registryConfigDir = '/tmp/registry_config';
    const hostDirs = fs.readdirSync(registryConfigDir);
    const results = [];

    for (const hostDir of hostDirs) {
      const hostDirPath = path.join(registryConfigDir, hostDir);
      if (fs.lstatSync(hostDirPath).isDirectory()) {
        const tomlFiles = fs.readdirSync(hostDirPath).filter(file => file.endsWith('.toml'));
        const domains = [];

        for (const tomlFile of tomlFiles) {
          const filePath = path.join(hostDirPath, tomlFile);
          const tomlContent = fs.readFileSync(filePath, 'utf-8');
          const parsedData = parseToml(tomlContent); // 假设 parseToml 是一个解析 TOML 的函数
          const domain = Object.keys(parsedData.host)[0];
          const domainInfo = {
            domain: domain,
            capabilities: parsedData.host[domain].capabilities
          };

          // 检查是否存在 authorization 字段
          if (parsedData.host[domain].header && parsedData.host[domain].header.authorization) {
            domainInfo.credentials = parsedData.host[domain].header.authorization;
          }

          domains.push(domainInfo);
        }

        results.push({
          hostIP: hostDir,
          domains: domains
        });
      }
    }
    return {
      code: 20000,
      data: results,
      msg: "镜像地址成功",
      status: "ok"
    };
  } catch (error) {
    console.error('查询镜像仓库时发生错误:', error.message || error);
    return {
      code: 50000,
      msg: '查询镜像仓库失败',
      status: "error"
    };
  }
}


module.exports = {
  addImageAddrJob,
  removeImageAddrJob,
  getImageAddrJob,
}