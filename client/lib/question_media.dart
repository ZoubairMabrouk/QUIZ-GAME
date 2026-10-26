import 'package:flutter/material.dart';
class QuestionMedia extends StatelessWidget {
  final dynamic media;
  const QuestionMedia({super.key,required this.media});
  @override
  Widget build(BuildContext context){
    if(media is! Map || media['type']!='image')return const SizedBox.shrink();
    return Padding(padding:const EdgeInsets.symmetric(vertical:12),child:Image.network(media['url'] as String,height:180,fit:BoxFit.contain,semanticLabel:media['alt'] as String,errorBuilder:(_,error,stack)=>Text('Image indisponible : ${media['alt']}')));
  }
}
