import importlib.util, json, os, socket, subprocess, tempfile, threading, time, unittest, uuid
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('agent',HERE/'agent.py');agent=importlib.util.module_from_spec(spec);spec.loader.exec_module(agent)
spec=importlib.util.spec_from_file_location('bootstrap',HERE/'bootstrap.py');bootstrap=importlib.util.module_from_spec(spec);spec.loader.exec_module(bootstrap)
class AgentTest(unittest.TestCase):
 def test_users_and_protocols(self):
  users=[{'userId':'one','email':'vvvion:one:account','secret':str(uuid.uuid4())}]
  base={'inbounds':[{'users':[]}],'experimental':{'v2ray_api':{'stats':{}}}}
  vless=agent.patch_config(base,users,'vless');hy=agent.patch_config(base,users,'hy2')
  self.assertEqual(vless['inbounds'][0]['users'][0]['uuid'],users[0]['secret'])
  self.assertEqual(hy['inbounds'][0]['users'][0]['password'],users[0]['secret'])
  self.assertEqual(agent.patch_config(base,[],'vless')['inbounds'][0]['users'],[])
  self.assertEqual(base['inbounds'][0]['users'],[])
 def test_counters_replays_restarts_and_devices(self):
  users=[{'email':'a','userId':'one'},{'email':'b','userId':'one'}];state={}
  stats=lambda a,b:{'user>>>a>>>traffic>>>uplink':a,'user>>>b>>>traffic>>>downlink':b}
  self.assertEqual(agent.collect(state,stats(100,200),users,'A'),[{'userId':'one','upload':100,'download':200}])
  self.assertEqual(agent.collect(state,stats(100,200),users,'A')[0]['upload'],100)
  self.assertEqual(agent.collect(state,stats(30,40),users,'B'),[{'userId':'one','upload':130,'download':240}])
  self.assertEqual(agent.collect(state,stats(35,50),users,'B'),[{'userId':'one','upload':135,'download':250}])
 def test_grpc_decode_and_malformed(self):
  self.assertEqual(agent.decode_stats(b'\x0a\x07\x0a\x03abc\x10\x05'),{'abc':5})
  with self.assertRaises(ValueError): agent.decode_stats(b'\x0a\xff')
 @unittest.skipUnless(os.environ.get('SING_BOX_BIN'),'set SING_BOX_BIN for actual protocol roundtrip')
 def test_actual_sing_box_vless_and_hy2(self):
  binary=os.environ['SING_BOX_BIN'];import grpc
  class Handler(BaseHTTPRequestHandler):
   def do_GET(self):
    content=b'VVVion Connect '*5000;self.send_response(200);self.send_header('Content-Length',str(len(content)));self.end_headers();self.wfile.write(content)
   def log_message(self,*args): pass
  http=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=http.serve_forever,daemon=True).start()
  try:
   with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);cert=root/'cert.pem';key=root/'key.pem'
    subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
    for protocol,port,proxy_port in [('vless',18543,18544),('hy2',18545,18546)]:
     with self.subTest(protocol=protocol):
      users=[{'userId':'one','email':'vvvion:one:account','secret':str(uuid.uuid4())}]
      plan={'protocol':protocol,'tls':'certificate','sni':'localhost','port':port,'certPath':str(cert),'keyPath':str(key)}
      server=agent.patch_config(bootstrap.config(plan),users,protocol);server['inbounds'][0]['listen']='127.0.0.1'
      server_path=root/'server.json';server_path.write_text(json.dumps(server))
      outbound={'type':'vless' if protocol=='vless' else 'hysteria2','tag':'proxy','server':'127.0.0.1','server_port':port,'tls':{'enabled':True,'server_name':'localhost','certificate_path':str(cert)}}
      outbound.update({'uuid':users[0]['secret'],'flow':'xtls-rprx-vision'} if protocol=='vless' else {'password':users[0]['secret']})
      client={'inbounds':[{'type':'mixed','listen':'127.0.0.1','listen_port':proxy_port}],'outbounds':[outbound]}
      client_path=root/'client.json';client_path.write_text(json.dumps(client))
      processes=[]
      try:
       for path in [server_path,client_path]:
        subprocess.run([binary,'check','-c',str(path)],check=True,capture_output=True)
        processes.append(subprocess.Popen([binary,'run','-c',str(path)],stdout=subprocess.DEVNULL,stderr=open(root/(path.stem+".log"),"w")))
       for _ in range(40):
        try:
         raw=agent.read_stats();break
        except: time.sleep(.1)
       for _ in range(60):
        try:
         with socket.create_connection(('127.0.0.1',proxy_port),timeout=.1): pass
         break
        except OSError: time.sleep(.1)
       if any(p.poll() is not None for p in processes) and 'create netlink socket: operation not permitted' in (root/'server.log').read_text(): self.skipTest('Sandbox denies netlink sockets; run the protocol roundtrip on a VPS')
       result=subprocess.run(['curl','--noproxy','','--proxy',f'http://127.0.0.1:{proxy_port}','--max-time','20','-fsS',f'http://127.0.0.1:{http.server_port}/'],check=True,capture_output=True)
       self.assertIn(b'VVVion Connect',result.stdout)
       raw=agent.read_stats();self.assertGreater(raw['user>>>vvvion:one:account>>>traffic>>>downlink'],50000);self.assertGreater(raw['user>>>vvvion:one:account>>>traffic>>>uplink'],0)
      except Exception:
       print((root/'server.log').read_text(),(root/'client.log').read_text())
       raise
      finally:
       for process in processes: process.terminate()
       for process in processes: process.wait(timeout=10)
  finally:http.shutdown();http.server_close()
if __name__=='__main__':unittest.main()
