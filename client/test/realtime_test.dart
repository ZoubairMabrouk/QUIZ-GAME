import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:quiz_game/realtime_client.dart';
import 'package:quiz_game/api.dart';
import 'package:flutter/widgets.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('background pause stops live state; resume immediately repairs destination', () async {
    final api=QuizApi('http://unused');
    var repairs=0;
    final states=<bool>[];
    final client=RealtimeClient(api:api,subscribe:()=>{'type':'subscribe','code':'ABC234'},
      onMessage:(_){},onLive:states.add,repair:()async{repairs++;});
    client.didChangeAppLifecycleState(AppLifecycleState.paused);
    expect(states.last,false);
    client.didChangeAppLifecycleState(AppLifecycleState.resumed);
    await Future<void>.delayed(Duration.zero);
    expect(repairs,1);
    client.close();api.dispose();
  });
  test('equal revision uses personal revision and server time, never arrival order', () {
    final old = <String,dynamic>{'revision':5,'personalRevision':1,'serverTime':'2026-10-26T12:00:02Z'};
    expect(acceptsSnapshot(old, {...old,'serverTime':'2026-10-26T12:00:01Z'}),false);
    expect(acceptsSnapshot(old, {...old,'personalRevision':0,'serverTime':'2026-10-26T12:00:03Z'}),false);
    expect(acceptsSnapshot(old, {...old,'personalRevision':2}),true);
    expect(acceptsSnapshot(old, {...old,'revision':4}),false);
    expect(acceptsSnapshot(old, {...old,'revision':6}),true);
    expect(acceptsSnapshot({'revision':1,'serverTime':20},{'revision':1,'serverTime':10}),false);
  });
  test('reconnect uses bounded exponential backoff with jitter', () {
    final random=Random(42);
    final delays=List.generate(20, (_) => reconnectDelay(10, random).inMilliseconds);
    expect(delays.toSet().length,greaterThan(1));
    expect(delays.every((d)=>d>=7500 && d<=15000),true);
  });
}
