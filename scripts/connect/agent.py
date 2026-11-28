#!/usr/bin/env python3
"""Connect sing-box agent: named users, V2Ray counters, fail closed after 5 minutes offline."""
import copy
import hashlib
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path('/opt/vvvion-connect')

def atomic(path, value):
    tmp = path.with_suffix('.tmp')
    with open(tmp, 'w') as out:
        os.chmod(tmp, 0o600)
        json.dump(value, out, ensure_ascii=False)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, path)

def api(settings, op, **extra):
    payload = json.dumps(dict(nodeId=settings['nodeId'], op=op, **extra)).encode()
    req = urllib.request.Request(settings['url'], payload, {'Content-Type':'application/json', 'Authorization':'Bearer '+settings['token']})
    # Never forward the node token to a redirect destination.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs): return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=15) as res:
        return json.load(res)

def patch_config(base, users, protocol):
    config = copy.deepcopy(base)
    inbound = config['inbounds'][0]
    field = 'uuid' if protocol == 'vless' else 'password'
    inbound['users'] = [dict(name=u['email'], **{field:u['secret']}, **({'flow':'xtls-rprx-vision'} if protocol=='vless' else {})) for u in users]
    config['experimental']['v2ray_api']['stats']['users'] = [u['email'] for u in users]
    return config

def varint(data, pos):
    value, shift = 0, 0
    while pos < len(data) and shift < 70:
        b = data[pos]; pos += 1
        value |= (b & 127) << shift
        if b < 128: return value, pos
        shift += 7
    raise ValueError('invalid varint')

def fields(data):
    pos = 0
    while pos < len(data):
        key, pos = varint(data, pos); wire = key & 7
        if wire == 0: value, pos = varint(data, pos)
        elif wire == 2:
            size, pos = varint(data, pos)
            if pos + size > len(data): raise ValueError('invalid length')
            value = data[pos:pos+size]; pos += size
        else: raise ValueError('unsupported wire type')
        yield key >> 3, value

def decode_stats(data):
    result = {}
    for field, value in fields(data):
        if field != 1 or not isinstance(value, bytes): continue
        row = dict(fields(value))
        name, count = row.get(1,b'').decode(), row.get(2,0)
        if isinstance(count, int) and 0 <= count < 2**63: result[name] = count
    return result

def read_stats():
    import grpc
    with grpc.insecure_channel('127.0.0.1:10085') as channel:
        call=channel.unary_unary('/v2ray.core.app.stats.command.StatsService/QueryStats')
        # pattern=user>>> ; reset=false. Never reset counters on read.
        return decode_stats(call(b'\x0a\x07user>>>', timeout=5))

def collect(state, raw, users, generation):
    previous = state.get('raw',{}) if state.get('generation') == generation else {}
    totals = state.setdefault('totals',{})
    for user in users:
        total = totals.setdefault(user['userId'], {'upload':0,'download':0})
        for suffix, key in [('uplink','upload'), ('downlink','download')]:
            name = 'user>>>'+user['email']+'>>>traffic>>>'+suffix
            value = raw.get(name,0)
            old = previous.get(name,0)
            total[key] += value-old if value>=old else value
    state['raw'] = raw
    state['generation'] = generation
    return [dict(userId=uid,**value) for uid,value in totals.items()]

def apply(settings, users):
    base=json.loads((ROOT/'base.json').read_text())
    next_config=patch_config(base,users,settings['protocol'])
    path=ROOT/'config.json'
    text=json.dumps(next_config,sort_keys=True)
    if path.exists() and json.dumps(json.loads(path.read_text()),sort_keys=True)==text: return False
    candidate=ROOT/'candidate.json'
    atomic(candidate,next_config)
    subprocess.run([str(ROOT/'sing-box'),'check','-c',str(candidate)],check=True,capture_output=True,timeout=15)
    old = path.read_bytes() if path.exists() else None
    os.replace(candidate,path)
    try:
        subprocess.run(['systemctl','restart','vvvion-connect.service'],check=True,capture_output=True,timeout=25)
        time.sleep(1)
        subprocess.run(['systemctl','is-active','--quiet','vvvion-connect.service'],check=True,timeout=5)
        read_stats()  # Fail installation if the binary lacks functional user statistics.
    except Exception:
        if old is not None:
            path.write_bytes(old)
            subprocess.run(['systemctl','restart','vvvion-connect.service'],capture_output=True,timeout=25)
        raise
    return True

def run():
    settings=json.loads((ROOT/'settings.json').read_text())
    state_path=ROOT/'counters.json'
    state=json.loads(state_path.read_text()) if state_path.exists() else {'totals':{}}
    users=json.loads((ROOT/'users.json').read_text()) if (ROOT/'users.json').exists() else []
    last_ok=0
    while True:
        try:
            if (ROOT/'config.json').exists():
                generation=subprocess.check_output(['systemctl','show','-p','InvocationID','--value','vvvion-connect.service'],timeout=5).decode().strip()
                totals=collect(state,read_stats(),users,generation)
                atomic(state_path,state)
                api(settings,'report',users=totals,reach='up')
            payload=api(settings,'pull')
            next_users=payload['users']
            # Establish zero baselines before a newly enrolled account can send traffic.
            for user in next_users: state.setdefault('totals',{}).setdefault(user['userId'],{'upload':0,'download':0})
            atomic(state_path,state)
            api(settings,'report',users=[dict(userId=uid,**value) for uid,value in state['totals'].items()],reach='up')
            apply(settings,next_users)
            users=next_users
            atomic(ROOT/'users.json',users)
            api(settings,'applied',ok=True,clients=len(users))
            api(settings,'provisioned',uri=settings['uri'])
            last_ok=time.monotonic()
        except Exception:
            # Never report invented zeros and never log credentials/provider bodies.
            try: api(settings,'report',reach='down',error='Агент не смог синхронизировать клиентов или счётчики')
            except Exception: pass
            if time.monotonic()-last_ok > 300:
                try:
                    apply(settings,[])
                    users=[]
                    atomic(ROOT/'users.json',users)
                except Exception: pass
        time.sleep(20)

if __name__=='__main__': run()
