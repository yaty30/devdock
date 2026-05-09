package com.ivs.dashboard.chat;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import java.util.List;

@Mapper
public interface WebsocketMapper {

    void insertMessage(ChatSocket.ChatMessage message);

    List<ChatSocket.ChatMessage> selectMessagesByConversationId(
        @Param("conversationId") String conversationId,
        @Param("limit") int limit
    );

}