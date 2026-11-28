#!/usr/bin/env python3
"""Detached, fresh-server-only installer. Source and Go toolchain are pinned."""
import json, os, platform, subprocess, tarfile, urllib.request, hashlib, shutil
from pathlib import Path
from agent import ROOT, api, atomic

GO_VERSION='1.26.11'
GO_SHA={'amd64':'9849f4e04ee35303714e34fbc3ac8ab44ea3e448a95aa182f91e3b9b79c710ec','arm64':'6c2f29b458b5add0835f18b776f69c8881a6d88428f1484a6da55755e620757e'}
SING_VERSION='v1.14.6'

def config(plan, private_key=''):
    tls={'enabled':True,'server_name':plan['sni']}
    if plan['tls']=='reality':
        tls['reality']={'enabled':True,'handshake':{'server':plan['handshake'],'server_port':plan['handshakePort']},'private_key':private_key,'short_id':[plan['shortId']]}
    else: tls.update(certificate_path=plan['certPath'],key_path=plan['keyPath'])
    if plan['protocol']=='hy2': tls['alpn']=['h3']
    inbound={'type':'vless' if plan['protocol']=='vless' else 'hysteria2','tag':'connect-in','listen':'::','listen_port':plan['port'],'users':[],'tls':tls}
    return {'log':{'level':'warn','timestamp':True},'inbounds':[inbound],'outbounds':[{'type':'direct','tag':'direct'}],'experimental':{'v2ray_api':{'listen':'127.0.0.1:10085','stats':{'enabled':True,'users':[]}}}}

def install():
    settings=json.loads((ROOT/'settings.json').read_text());plan=settings['plan']
    def phase(note):
        atomic(ROOT/'install-status.json',{'phase':note})
        api(settings,'installation',phase=note)
    try:
        phase('Устанавливаем зависимости')
        env=dict(os.environ,DEBIAN_FRONTEND='noninteractive')
        subprocess.run(['apt-get','update'],check=True,timeout=300,env=env)
        subprocess.run(['apt-get','install','-y','--no-install-recommends','python3-grpcio','ca-certificates','openssl'],check=True,timeout=600,env=env)
        phase('Собираем sing-box со счётчиками пользователей')
        arch={'x86_64':'amd64','aarch64':'arm64'}[platform.machine()]
        archive=ROOT/'go.tar.gz'
        with urllib.request.urlopen('https://go.dev/dl/go'+GO_VERSION+'.linux-'+arch+'.tar.gz',timeout=120) as src, open(archive,'wb') as out: shutil.copyfileobj(src,out)
        if hashlib.sha256(archive.read_bytes()).hexdigest()!=GO_SHA[arch]: raise ValueError('Go checksum mismatch')
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                if not member.name.startswith('go/') or '..' in Path(member.name).parts or member.issym() or member.islnk(): raise ValueError('invalid Go archive')
            tar.extractall(ROOT)
        archive.unlink()
        env=dict(os.environ,GOBIN=str(ROOT),GOMAXPROCS='2',GOMEMLIMIT='512MiB',GOTOOLCHAIN='local',CGO_ENABLED='0',GOSUMDB='sum.golang.org',GOPATH=str(ROOT/'build'),GOCACHE=str(ROOT/'build-cache'))
        subprocess.run([str(ROOT/'go/bin/go'),'install','-p','1','-tags','with_quic,with_utls,with_v2ray_api','github.com/sagernet/sing-box/cmd/sing-box@'+SING_VERSION],check=True,timeout=1800,env=env)
        for build_dir in ['go','build','build-cache']: shutil.rmtree(ROOT/build_dir)
        if plan['tls']=='certificate':
            import ipaddress
            try: ipaddress.ip_address(plan['sni']); name_flag='-checkip'
            except ValueError: name_flag='-checkhost'
            subprocess.run(['openssl','x509','-in',plan['certPath'],name_flag,plan['sni'],'-noout'],check=True,capture_output=True,timeout=10)
            subprocess.run(['openssl','x509','-in',plan['certPath'],'-checkend','0','-noout'],check=True,capture_output=True,timeout=10)
        private,public='',''
        if plan['tls']=='reality':
            keys=subprocess.check_output([str(ROOT/'sing-box'),'generate','reality-keypair'],text=True,timeout=10)
            rows=dict(line.split(': ',1) for line in keys.strip().splitlines())
            private,public=rows['PrivateKey'],rows['PublicKey']
        phase('Проверяем конфигурацию и запускаем службы')
        atomic(ROOT/'base.json',config(plan,private))
        from urllib.parse import urlencode, quote
        host=plan['host']
        if ':' in host: host='['+host+']'
        query={'sni':plan['sni']}
        if plan['protocol']=='vless':
            query.update(type='tcp',security=plan['tls']=='reality' and 'reality' or 'tls',flow='xtls-rprx-vision',fp='chrome')
            if public: query.update(pbk=public,sid=plan['shortId'])
        else: query['alpn']='h3'
        settings['uri']=plan['protocol']+'://{secret}@'+host+':'+str(plan['port'])+'?'+urlencode(query)+'#'+quote(plan['name'])
        atomic(ROOT/'settings.json',settings)
        # Check features, TLS certificate, keys and syntax before opening the listener.
        subprocess.run([str(ROOT/'sing-box'),'check','-c',str(ROOT/'base.json')],check=True,capture_output=True,timeout=15)
        unit='''[Unit]
Description=VVVion Connect sing-box
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/opt/vvvion-connect/sing-box run -c /opt/vvvion-connect/config.json
Restart=on-failure
RestartSec=3
UMask=0077
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
'''
        agent='''[Unit]
Description=VVVion Connect subscription agent
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/bin/python3 /opt/vvvion-connect/agent.py
Restart=always
RestartSec=5
UMask=0077
[Install]
WantedBy=multi-user.target
'''
        Path('/etc/systemd/system/vvvion-connect.service').write_text(unit)
        Path('/etc/systemd/system/vvvion-connect-agent.service').write_text(agent)
        subprocess.run(['systemctl','daemon-reload'],check=True,timeout=20)
        subprocess.run(['systemctl','enable','vvvion-connect.service','vvvion-connect-agent.service'],check=True,timeout=20)
        # Only open the requested data port if UFW is already active. Never reset a firewall.
        ufw=shutil.which('ufw')
        if ufw and 'Status: active' in subprocess.check_output([ufw,'status'],text=True,timeout=10):
            subprocess.run([ufw,'allow',str(plan['port'])+('/udp' if plan['protocol']=='hy2' else '/tcp')],check=True,timeout=20)
        subprocess.run(['systemctl','start','vvvion-connect-agent.service'],check=True,timeout=20)
        atomic(ROOT/'install-status.json',{'phase':'Ожидаем первый отчёт агента'})
    except Exception:
        atomic(ROOT/'install-status.json',{'phase':'Ошибка установки: проверьте журнал службы на VPS'})
        try: api(settings,'installation',phase='Ошибка установки: проверьте журнал службы на VPS')
        except Exception: pass
        raise RuntimeError('Connect installation failed; inspect local systemd journal') from None

if __name__=='__main__': install()
