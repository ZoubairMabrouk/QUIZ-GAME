import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'api.dart';
class RoomSharePage extends StatefulWidget {
  final QuizApi api;final String code;
  const RoomSharePage({super.key,required this.api,required this.code});
  @override
  State<RoomSharePage> createState()=>_RoomSharePageState();
}
class _RoomSharePageState extends State<RoomSharePage> {
  late Future<Map<String,dynamic>> share;
  @override
  void initState(){super.initState();share=widget.api.call('/rooms/${widget.code}/share');}
  @override
  Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:const Text('Inviter dans la salle')),body:FutureBuilder<Map<String,dynamic>>(future:share,builder:(context,snapshot){
    if(snapshot.hasError)return Center(child:Column(mainAxisSize:MainAxisSize.min,children:[Text('${snapshot.error}'),TextButton(onPressed:()=>setState(()=>share=widget.api.call('/rooms/${widget.code}/share')),child:const Text('Réessayer'))]));
    if(!snapshot.hasData)return const Center(child:CircularProgressIndicator());
    final data=snapshot.data!;
    return ListView(padding:const EdgeInsets.all(20),children:[Text('Code : ${widget.code}',style:Theme.of(context).textTheme.headlineMedium),Center(child:Image.memory(base64Decode((data['qr'] as String).split(',').last),width:256,height:256,semanticLabel:'QR du lien d’invitation')),SelectableText(data['link'] as String),FilledButton(onPressed:()async{await Clipboard.setData(ClipboardData(text:data['link'] as String));},child:const Text('Copier le lien'))]);
  }));
}
