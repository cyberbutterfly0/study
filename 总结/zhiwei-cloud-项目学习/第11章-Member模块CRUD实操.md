# 第11章 Member 模块 CRUD 实操教程

> 场景：11-14 会议分工，我拿到 member 表。目标是把 `member_info` 的「分页 / 详情 / 新增 / 修改 / 删除」5 个接口写出来、起服务、Swagger 调通、过门禁、提交。
> 参考实现：system 模块的「通知公告」`SysNotice`（五层最完整、比用户模块简单）。
> 负责人给的参考：`SysUserController` 的接口风格（`/api/system/user/create1`）、根 `.env` 的配置键、IDEA 的启动配置（Member / Infra / System / Gateway 四个 Application + `npm run`）。

腾讯 test-16 新库没到也能做前四步（拉分支、写五层代码、写权限码 SQL、写单测）；建表、连库、联调等库到了再做。

## 一、先看清目标与现状

| 项 | 现状（11-15 核对） |
|---|---|
| 目标表 | `member_info`（会员主体，平台级，`org_id` 恒 0） |
| 建表脚本 | `sql/member/20261107_01_zhiwei_member_tables.sql`（6 张表，本次只用 member_info） |
| 已有代码 | `zhiwei-module-member-server` 只有 `MemberServerApplication` + `HealthController` |
| 依赖 | server 已引 web / mybatis / redis / security / nacos；api 只有 common + openfeign |
| 端口 | **48083** |
| 网关路由 | 已登记 `lb://zhiwei-member-server`，`Path=/api/member/**` |
| 权限码 | 未登记（`sys_menu` 里只有 system 的按钮） |
| 门禁 | `check_api_permissions` 强制「接口方法必须有 @PreAuthorize，权限码必须在菜单 SQL 里」 |

会议说的「四个接口」，参考实现实际是 5 个：`page`（分页列表）、`get`（详情）、`create`、`update`、`delete`。按 5 个做。

## 二、第 0 步：拉分支

```powershell
cd E:\study\zhiwei-cloud
git status                       # 先看有没有未提交改动（当前有 docker-compose.yml + .bak 文件）
git fetch origin
git checkout master
git pull
git checkout -b c-1.2            # 分支名按团队约定，本地已有 c-1.1
```

注意：

- 别直接改 `c-1.1`，它现在和 master 平齐，动了不好回退。
- 工作区那两处 `docker-compose.yml` 改动是你 11-03 本地 nacos 的调整，**不要**顺手提交进业务分支；要么先 `git stash`，要么单独处理。

## 三、第 1 步：数据库（等新库）

### 3.1 改 `.env`

根目录 `.env` 现在是阿里云 PolarDB 的值（`DB_HOST=ydmap-ops.mysql.polardb.rds.aliyuncs.com`、`DB_NAME=test_ming_study`）。等讲师发腾讯 test-16 地址后，只改这几行：

```properties
DB_HOST=<腾讯库地址>
DB_PORT=3306
DB_NAME=test-16
DB_USER=<账号>
DB_PASS=<密码>
```

`JWT_SECRET` 不动——system / infra / member 三个服务必须用**同一份** `.env`，否则 A 服务签的 Token 到 B 服务验签失败，表现为「登录成功，调 member 就 401」。

### 3.2 执行建表脚本

```powershell
mysql -h <host> -P 3306 -u <user> -p test-16 < sql/member/20261107_01_zhiwei_member_tables.sql
```

验证：

```sql
SHOW TABLES LIKE 'member%';                    -- 6 张
SHOW CREATE TABLE member_info;                 -- 看 uk_member_no / chk_member_tags_array 在不在
```

### 3.3 member 表的三条规矩

1. **平台级表，`org_id` 恒 0、`org_name` 恒空**。DDL 里已有默认值，代码里**不要**从登录态取 `orgId` 塞进去。
2. `member-server` 没引 `biz-tenant`，所以 SQL 不会被按 `org_id` 改写——这是对的。将来若引入 `biz-tenant`，必须把 `member_info` 等平台级表加进 `TenantSqlInterceptor.IGNORE_TABLES`，否则全平台会员会被读成「某个单位的会员」。
3. `deleted` 是 `BIGINT`（0=正常，>0=记录 ID），删除走 `logicDeleteById`，不要手写 `UPDATE deleted=1`。

## 四、第 2 步：登记权限码（不做这步接口永远 403）

### 4.1 为什么必须做

- `@PreAuthorize("hasAuthority('member:info:page')")` 里的权限码，只认 `sys_menu.permission`（`type=3` 按钮）里登记过的值。编一个「看着像」的码不会报错，只会让接口永远 403，日志还干干净净。
- 门禁 `check_api_permissions` 会静态检查这件事，权限码不在 SQL 菜单数据里直接 must_fix，提交被拦。

### 4.2 写 SQL

新建 `sql/member/20261115_01_zhiwei_member_menu.sql`（日期取你提交那天），照抄通知模块的列顺序：

```sql
-- ── 一级目录：会员管理
INSERT INTO `sys_menu` (`id`, `name`, `parent_id`, `type`, `path`, `component`, `component_name`, `permission`, `icon`, `status`, `visible`, `keep_alive`, `always_show`, `sort`, `org_id`)
VALUES (1001200, '会员管理', 0, 1, '/member', NULL, NULL, NULL, 'lucide:users', 0, 1, 1, 1, 6, 0);

-- ── 会员信息
INSERT INTO `sys_menu` (`id`, `name`, `parent_id`, `type`, `path`, `component`, `component_name`, `permission`, `icon`, `status`, `visible`, `keep_alive`, `always_show`, `sort`, `org_id`)
VALUES (1001201, '会员信息', 1001200, 2, '/member/info', 'member/info/index', 'MemberInfoManage', NULL, 'lucide:user', 0, 1, 1, 1, 100, 0);

INSERT INTO `sys_menu` (`id`, `name`, `parent_id`, `type`, `path`, `component`, `component_name`, `permission`, `icon`, `status`, `visible`, `keep_alive`, `always_show`, `sort`, `org_id`) VALUES
(1001202, '会员查询', 1001201, 3, NULL, NULL, NULL, 'member:info:page',   NULL, 0, 1, 1, 1, 1, 0),
(1001203, '会员详情', 1001201, 3, NULL, NULL, NULL, 'member:info:get',    NULL, 0, 1, 1, 1, 2, 0),
(1001204, '会员新增', 1001201, 3, NULL, NULL, NULL, 'member:info:create', NULL, 0, 1, 1, 1, 3, 0),
(1001205, '会员修改', 1001201, 3, NULL, NULL, NULL, 'member:info:update', NULL, 0, 1, 1, 1, 4, 0),
(1001206, '会员删除', 1001201, 3, NULL, NULL, NULL, 'member:info:delete', NULL, 0, 1, 1, 1, 5, 0);
```

id 段选 `1001200~1001206`：避开通知（1001xxx）和日志（1001100）。

如果 test-16 是讲师统一管的、不给你写 `sys_menu` 的权限，把这段发给讲师让他并进 `sql/base/20261102_03_zhiwei_base_init_data.sql`。**代码里的权限码字符串不要自己改**，两边必须一致。

### 4.3 给角色授权

只登记菜单不够，还要让 admin 的角色拥有这些按钮。启动 system 后：系统管理 → 角色 → admin 角色 → 编辑菜单 → 勾上「会员管理 / 会员信息 / 5 个按钮」→ 保存 → 退出重登（权限码在登录时加载进 Token 上下文）。

### 4.4 验证

```sql
SELECT id, name, parent_id, type, permission FROM sys_menu WHERE permission LIKE 'member:info:%';
```

## 五、第 3 步：写五层代码

按依赖顺序写：`api 模块 → Req/Res → Feign 接口 → Entity → Mapper → Converter → Service → Controller`。

### 5.1 api 模块补依赖

`zhiwei-module-member/zhiwei-module-member-api/pom.xml` 追加（照 `zhiwei-module-infra/.../infra-api/pom.xml` 和 system-api 的写法，版本由 BOM 管，不写 `<version>`）：

```xml
<!-- Lombok：provided 不传递，DTO 用到 @Getter/@Setter 必须自行声明 -->
<dependency>
    <groupId>org.projectlombok</groupId>
    <artifactId>lombok</artifactId>
    <scope>provided</scope>
</dependency>
<!-- 校验注解 @NotBlank/@Size（版本由 Boot BOM 管理） -->
<dependency>
    <groupId>jakarta.validation</groupId>
    <artifactId>jakarta.validation-api</artifactId>
</dependency>
<!-- IPage/Page 分页类型（feign 接口返回分页结果时需要） -->
<dependency>
    <groupId>com.baomidou</groupId>
    <artifactId>mybatis-plus-extension</artifactId>
</dependency>
```

### 5.2 Req / Res

`zhiwei-module-member/zhiwei-module-member-api/src/main/java/cloud/zhiwei/member/pojo/req/MemberInfoPageReq.java`：

```java
package cloud.zhiwei.member.pojo.req;

import lombok.Getter;
import lombok.Setter;

/**
 * <h1>会员分页查询参数</h1>
 *
 * @author zhiwei
 */
@Getter
@Setter
public class MemberInfoPageReq {

    /** 页码（从 1 开始） */
    private Integer page = 1;

    /** 每页条数 */
    private Integer pageSize = 10;

    /** 关键字：昵称或手机号模糊匹配 */
    private String keyword;

    /** 状态：1=正常，2=冻结，3=已注销，4=已合并 */
    private Integer status;
}
```

`.../pojo/req/MemberInfoCreateReq.java`：

```java
package cloud.zhiwei.member.pojo.req;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

/**
 * <h1>会员新增参数</h1>
 *
 * @author zhiwei
 */
@Getter
@Setter
public class MemberInfoCreateReq {

    @NotBlank(message = "会员编号不能为空")
    @Size(max = 32, message = "会员编号不能超过 32 个字符")
    private String memberNo;

    @Size(max = 64, message = "真实姓名不能超过 64 个字符")
    private String realName;

    @Size(max = 64, message = "昵称不能超过 64 个字符")
    private String nickname;

    @Size(max = 32, message = "手机号不能超过 32 个字符")
    private String mobile;

    @Size(max = 128, message = "邮箱不能超过 128 个字符")
    private String email;

    /** 性别：0=未知，1=男，2=女 */
    private Integer gender = 0;

    private LocalDate birthday;

    /** 注册来源：wechat_mini/h5/app/pos/admin/import/api */
    private String registerSource = "admin";

    /** 状态：1=正常 */
    private Integer status = 1;

    private String remark;
}
```

`.../pojo/req/MemberInfoUpdateReq.java`：

```java
package cloud.zhiwei.member.pojo.req;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;

/**
 * <h1>会员修改参数</h1>
 *
 * @author zhiwei
 */
@Getter
@Setter
public class MemberInfoUpdateReq {

    @NotNull(message = "会员 ID 不能为空")
    private Long id;

    @Size(max = 64, message = "真实姓名不能超过 64 个字符")
    private String realName;

    @Size(max = 64, message = "昵称不能超过 64 个字符")
    private String nickname;

    @Size(max = 32, message = "手机号不能超过 32 个字符")
    private String mobile;

    @Size(max = 128, message = "邮箱不能超过 128 个字符")
    private String email;

    /** 性别：0=未知，1=男，2=女 */
    private Integer gender;

    private LocalDate birthday;

    /** 状态：1=正常，2=冻结，3=已注销，4=已合并 */
    private Integer status;

    private String remark;
}
```

`.../pojo/res/MemberInfoRes.java`：

```java
package cloud.zhiwei.member.pojo.res;

import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * <h1>会员响应</h1>
 *
 * @author zhiwei
 */
@Getter
@Setter
public class MemberInfoRes {

    private Long id;

    private String memberNo;

    private String realName;

    private String nickname;

    private String mobile;

    private String email;

    /** 性别：0=未知，1=男，2=女 */
    private Integer gender;

    private LocalDate birthday;

    /** 状态：1=正常，2=冻结，3=已注销，4=已合并 */
    private Integer status;

    /** 注册来源 */
    private String registerSource;

    /** 关联的 biz_info ID，0=未关联 */
    private Long bizInfoId;

    private String remark;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}
```

### 5.3 Feign 接口

`.../api/MemberInfoApi.java`：

```java
package cloud.zhiwei.member.api;

import cloud.zhiwei.common.Ret;
import cloud.zhiwei.member.pojo.req.MemberInfoCreateReq;
import cloud.zhiwei.member.pojo.req.MemberInfoPageReq;
import cloud.zhiwei.member.pojo.req.MemberInfoUpdateReq;
import cloud.zhiwei.member.pojo.res.MemberInfoRes;
import com.baomidou.mybatisplus.core.metadata.IPage;
import jakarta.validation.Valid;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;

/**
 * <h1>会员信息 Feign 契约</h1>
 *
 * @author zhiwei
 */
@FeignClient(name = "zhiwei-member-server", path = "/api/member/info", contextId = "memberInfoApi")
public interface MemberInfoApi {

    /**
     * 分页查询会员。
     *
     * @param req 分页与筛选条件
     * @return 分页结果
     */
    @GetMapping("/page")
    Ret<IPage<MemberInfoRes>> page(MemberInfoPageReq req);

    /**
     * 查询会员详情。
     *
     * @param id 会员 ID
     * @return 会员详情
     */
    @GetMapping("/get")
    Ret<MemberInfoRes> get(@RequestParam Long id);

    /**
     * 新增会员。
     *
     * @param req 新增参数
     * @return 无数据成功响应
     */
    @PostMapping("/create")
    Ret<Void> create(@Valid @RequestBody MemberInfoCreateReq req);

    /**
     * 修改会员。
     *
     * @param req 修改参数
     * @return 无数据成功响应
     */
    @PostMapping("/update")
    Ret<Void> update(@Valid @RequestBody MemberInfoUpdateReq req);

    /**
     * 删除会员（逻辑删除）。
     *
     * @param id 会员 ID
     * @return 无数据成功响应
     */
    @PostMapping("/delete")
    Ret<Void> delete(@RequestParam Long id);
}
```

两个坑（第 7 章 #14）：`@FeignClient` 接口上**不能**再写类级 `@RequestMapping`，前缀只能放 `path=`；`@RequestMapping` 方法也不能带 `@RequestBody` 之外的多余包装。

### 5.4 Entity

`zhiwei-module-member-server/src/main/java/cloud/zhiwei/member/entity/MemberInfo.java`：

```java
package cloud.zhiwei.member.entity;

import cloud.zhiwei.framework.mybatis.model.BaseEntity;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * <h1>会员主体实体</h1>
 * <p>对应 {@code member_info} 表。公共字段（id / orgId / createTime / updateTime / deleted 等）
 * 继承自 {@link BaseEntity}，这里只声明业务字段。</p>
 *
 * @author zhiwei
 */
@Getter
@Setter
@TableName("member_info")
public class MemberInfo extends BaseEntity {

    /** 会员编号（平台唯一） */
    private String memberNo;

    /** 注册来源业务 ID（biz_info.id），0=未关联 */
    private Long bizInfoId;

    /** 注册来源：wechat_mini/h5/app/pos/admin/import/api */
    private String registerSource;

    /** 真实姓名 */
    private String realName;

    /** 昵称 */
    private String nickname;

    /** 联系手机号（非登录凭据，可空可重复） */
    private String mobile;

    /** 邮箱 */
    private String email;

    /** 证件类型：0=未填，1=身份证，2=护照… */
    private Integer certType;

    /** 证件号码（练习环境明文） */
    private String certNo;

    /** 证件核验状态：0=未核验，1=已核验，2=核验失败 */
    private Integer certVerified;

    /** 性别：0=未知，1=男，2=女 */
    private Integer gender;

    /** 出生日期 */
    private LocalDate birthday;

    /** 状态：1=正常，2=冻结，3=已注销，4=已合并 */
    private Integer status;

    /** 注销时间 */
    private LocalDateTime cancelTime;

    /** 合并目标会员 ID，0=未合并 */
    private Long mergeTargetId;

    /** 运营标签（JSON 数组字符串） */
    private String tags;
}
```

**不要**重复声明 `id`、`deleted`、`orgId`、`createTime`、`updateTime`、`operatorId`、`operatorName`、`sort`、`remark`、`orgName`——`BaseEntity` 全有。也**不要**给 `id` 加 `@TableId`：`BaseEntity` 已声明 `@TableId(type = IdType.ASSIGN_ID)`，`member_info.id` 是雪花、不是自增。

### 5.5 Mapper

```java
package cloud.zhiwei.member.mapper;

import cloud.zhiwei.framework.mybatis.mapper.ZhiWeiBaseMapper;
import cloud.zhiwei.member.entity.MemberInfo;
import org.apache.ibatis.annotations.Mapper;

/**
 * <h1>会员主体 Mapper</h1>
 *
 * @author zhiwei
 */
@Mapper
public interface MemberInfoMapper extends ZhiWeiBaseMapper<MemberInfo> {
}
```

继承 `ZhiWeiBaseMapper` 而不是 `BaseMapper`，才有 `logicDeleteById`（它把 `deleted` 设为记录 ID，直接 `deleteById` 会把 `deleted` 设成 1，破坏「deleted=id」约定）。

### 5.6 Converter（MapStruct）

```java
package cloud.zhiwei.member.convert;

import cloud.zhiwei.member.entity.MemberInfo;
import cloud.zhiwei.member.pojo.res.MemberInfoRes;
import org.mapstruct.Mapper;
import org.mapstruct.ReportingPolicy;

/**
 * <h1>会员对象转换器</h1>
 *
 * @author zhiwei
 */
@Mapper(componentModel = "spring", unmappedTargetPolicy = ReportingPolicy.ERROR)
public interface MemberInfoConverter {

    /**
     * 实体转响应对象。
     *
     * @param memberInfo 会员实体
     * @return 会员响应
     */
    MemberInfoRes toRes(MemberInfo memberInfo);
}
```

`unmappedTargetPolicy = ERROR` 表示「Res 里有字段、Entity 里没有对应源」会编译失败——这是故意的，防止 Res 漏赋值。真需要手写映射时加 `@Mapping`。

### 5.7 Service

接口 `.../service/MemberInfoService.java`：

```java
package cloud.zhiwei.member.service;

import cloud.zhiwei.member.pojo.req.MemberInfoCreateReq;
import cloud.zhiwei.member.pojo.req.MemberInfoPageReq;
import cloud.zhiwei.member.pojo.req.MemberInfoUpdateReq;
import cloud.zhiwei.member.pojo.res.MemberInfoRes;
import com.baomidou.mybatisplus.core.metadata.IPage;

/**
 * <h1>会员信息业务接口</h1>
 *
 * @author zhiwei
 */
public interface MemberInfoService {

    IPage<MemberInfoRes> getMemberInfoPage(MemberInfoPageReq req);

    MemberInfoRes getMemberInfo(Long id);

    void createMemberInfo(MemberInfoCreateReq req);

    void updateMemberInfo(MemberInfoUpdateReq req);

    void deleteMemberInfo(Long id);
}
```

实现 `.../service/impl/MemberInfoServiceImpl.java`：

```java
package cloud.zhiwei.member.service.impl;

import cloud.zhiwei.common.Args;
import cloud.zhiwei.enums.ErrorCode;
import cloud.zhiwei.exception.ServiceException;
import cloud.zhiwei.member.convert.MemberInfoConverter;
import cloud.zhiwei.member.entity.MemberInfo;
import cloud.zhiwei.member.mapper.MemberInfoMapper;
import cloud.zhiwei.member.pojo.req.MemberInfoCreateReq;
import cloud.zhiwei.member.pojo.req.MemberInfoPageReq;
import cloud.zhiwei.member.pojo.req.MemberInfoUpdateReq;
import cloud.zhiwei.member.pojo.res.MemberInfoRes;
import cloud.zhiwei.member.service.MemberInfoService;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

/**
 * <h1>会员信息业务实现</h1>
 *
 * @author zhiwei
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class MemberInfoServiceImpl implements MemberInfoService {

    private final MemberInfoMapper memberInfoMapper;

    private final MemberInfoConverter memberInfoConverter;

    @Override
    public IPage<MemberInfoRes> getMemberInfoPage(MemberInfoPageReq req) {
        Args.notNull(req, "req");
        LambdaQueryWrapper<MemberInfo> wrapper = new LambdaQueryWrapper<>();
        if (StringUtils.hasText(req.getKeyword())) {
            wrapper.and(sub -> sub.like(MemberInfo::getNickname, req.getKeyword())
                .or()
                .like(MemberInfo::getMobile, req.getKeyword()));
        }
        wrapper.eq(req.getStatus() != null, MemberInfo::getStatus, req.getStatus());
        wrapper.orderByDesc(MemberInfo::getCreateTime);
        Page<MemberInfo> page = new Page<>(req.getPage(), req.getPageSize());
        IPage<MemberInfo> result = memberInfoMapper.selectPage(page, wrapper);
        return result.convert(memberInfoConverter::toRes);
    }

    @Override
    public MemberInfoRes getMemberInfo(Long id) {
        Args.notNull(id, "id");
        return memberInfoConverter.toRes(getMemberInfoOrThrow(id));
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void createMemberInfo(MemberInfoCreateReq req) {
        Args.notNull(req, "req");
        MemberInfo memberInfo = new MemberInfo();
        memberInfo.setMemberNo(req.getMemberNo());
        memberInfo.setRealName(req.getRealName());
        memberInfo.setNickname(req.getNickname());
        memberInfo.setMobile(req.getMobile());
        memberInfo.setEmail(req.getEmail());
        memberInfo.setGender(req.getGender());
        memberInfo.setBirthday(req.getBirthday());
        memberInfo.setRegisterSource(req.getRegisterSource());
        memberInfo.setStatus(req.getStatus());
        memberInfo.setRemark(req.getRemark());
        memberInfoMapper.insert(memberInfo);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void updateMemberInfo(MemberInfoUpdateReq req) {
        Args.notNull(req, "req");
        MemberInfo memberInfo = getMemberInfoOrThrow(req.getId());
        memberInfo.setRealName(req.getRealName());
        memberInfo.setNickname(req.getNickname());
        memberInfo.setMobile(req.getMobile());
        memberInfo.setEmail(req.getEmail());
        memberInfo.setGender(req.getGender());
        memberInfo.setBirthday(req.getBirthday());
        memberInfo.setStatus(req.getStatus());
        memberInfo.setRemark(req.getRemark());
        memberInfoMapper.updateById(memberInfo);
    }

    @Override
    @Transactional(rollbackFor = Exception.class)
    public void deleteMemberInfo(Long id) {
        Args.notNull(id, "id");
        int affected = memberInfoMapper.logicDeleteById(id);
        if (affected == 0) {
            throw new ServiceException(ErrorCode.NOT_FOUND);
        }
    }

    /**
     * 按主键查询会员，不存在时抛业务异常。
     *
     * @param id 会员 ID
     * @return 会员实体
     */
    private MemberInfo getMemberInfoOrThrow(Long id) {
        MemberInfo memberInfo = memberInfoMapper.selectById(id);
        if (memberInfo == null) {
            throw new ServiceException(ErrorCode.NOT_FOUND);
        }
        return memberInfo;
    }
}
```

几个要点：

- `Args.notNull` 是团队封装的参数校验，抛的是带提示的 `ServiceException`，别用 `Objects.requireNonNull`。
- `private` 方法写在 `public` 之后（`check_method_order` 会查）。
- 不用三元运算符（团队 27 条质量要求），`wrapper.eq(条件, ...)` 这种重载可以。
- 写操作加 `@Transactional(rollbackFor = Exception.class)`。
- 删除必须 `logicDeleteById`；`deleteById` 会写 `deleted=1`，之后按 `deleted=0` 查不到，但唯一键里 `(member_no, deleted=1)` 这种值仍占位，时间久了唯一键语义就乱了。

### 5.8 Controller

`.../controller/MemberInfoController.java`：

```java
package cloud.zhiwei.member.controller;

import cloud.zhiwei.common.Ret;
import cloud.zhiwei.member.api.MemberInfoApi;
import cloud.zhiwei.member.pojo.req.MemberInfoCreateReq;
import cloud.zhiwei.member.pojo.req.MemberInfoPageReq;
import cloud.zhiwei.member.pojo.req.MemberInfoUpdateReq;
import cloud.zhiwei.member.pojo.res.MemberInfoRes;
import cloud.zhiwei.member.service.MemberInfoService;
import com.baomidou.mybatisplus.core.metadata.IPage;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * <h1>会员信息接口</h1>
 * <p>权限码取自 {@code sys_menu.permission}（type=3 按钮数据），详见第 11 章第四节。</p>
 *
 * @author zhiwei
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@RequestMapping("/api/member/info")
public class MemberInfoController implements MemberInfoApi {

    private final MemberInfoService memberInfoService;

    @Override
    @PreAuthorize("hasAuthority('member:info:page')")
    public Ret<IPage<MemberInfoRes>> page(MemberInfoPageReq req) {
        return Ret.ok(memberInfoService.getMemberInfoPage(req));
    }

    @Override
    @PreAuthorize("hasAuthority('member:info:get')")
    public Ret<MemberInfoRes> get(Long id) {
        return Ret.ok(memberInfoService.getMemberInfo(id));
    }

    @Override
    @PreAuthorize("hasAuthority('member:info:create')")
    public Ret<Void> create(MemberInfoCreateReq req) {
        memberInfoService.createMemberInfo(req);
        return Ret.ok();
    }

    @Override
    @PreAuthorize("hasAuthority('member:info:update')")
    public Ret<Void> update(MemberInfoUpdateReq req) {
        memberInfoService.updateMemberInfo(req);
        return Ret.ok();
    }

    @Override
    @PreAuthorize("hasAuthority('member:info:delete')")
    public Ret<Void> delete(Long id) {
        memberInfoService.deleteMemberInfo(id);
        return Ret.ok();
    }
}
```

注意 `@PreAuthorize` **必须单行写**：门禁的 `check_api_permissions` 只认单行注解，跨行会漏判（等于白写，但接口还是有权限，只是门禁报「没加」）。

### 5.9 （可选）单测

照 system 的 `SysNoticeServiceImplTest` / `PermissionTest` 写法补一个 `MemberInfoServiceImplTest`：mock Mapper + Converter，覆盖「分页」「查不到抛 NOT_FOUND」「删除 0 行抛 NOT_FOUND」。门禁不强制，但提交合并时评审会看。

## 六、第 4 步：启动

### 6.1 起基础设施

```powershell
cd E:\study\zhiwei-cloud
docker compose up -d          # 只起 Redis + Nacos，不含 MySQL
```

Nacos 3.x 控制台：`http://localhost:18080/`（容器内 8080）；注册中心 8848。

### 6.2 构建

```powershell
mvn clean install -DskipTests
```

必须看到 `BUILD SUCCESS`。如果 `target/classes` 里只有 yml 没有 class，参考第 7 章坑 #13。

### 6.3 起 member

IDEA 的 Services 面板里已经有 `MemberServerApplication`（负责人截图里四个 Application：Member / Infra:48082 / System:48081 / Gateway:48080）。直接 Run：

- 工作目录（Working directory）设成**仓库根**，`.env` 才读得到；member 的 `spring.config.import` 同时写了 `.env` 和 `../../.env`，模块目录启动也能兜住。
- Profile 用默认 `dev`（`application.yml` 里已写 `active: dev`）。

命令行方式（member 的 pom 已声明 `spring-boot-maven-plugin`，可以直接跑）：

```powershell
mvn -pl zhiwei-module-member/zhiwei-module-member-server spring-boot:run
```

### 6.4 验证

```powershell
curl http://localhost:48083/api/member/health
```

应返回 200 + `Ret` 包装的 `member-server is running`。启动报错对照见第九节。

## 七、第 5 步：Swagger 调通

### 7.1 登录拿 Token

先起 system（48081），打开 `http://localhost:48081/doc.html`（Knife4j 界面，左侧按 controller 分组，负责人给的截图就是这个）：

1. 找 `sys-auth-controller` → `POST /api/auth/login`
2. Body：`{"username":"admin","password":"123456"}`
3. 响应 `data.token` 那串就是 Token
4. 右上角「全局参数」/「Authorize」里加 `Authorization` = `Bearer <token>`

### 7.2 打开 member 的 Swagger

`http://localhost:48083/doc.html` → 左侧应该出现 `member-info-controller`，5 个接口：

| 接口 | 方法 | 地址 |
|---|---|---|
| 分页 | GET | `/api/member/info/page?page=1&pageSize=10` |
| 详情 | GET | `/api/member/info/get?id=<id>` |
| 新增 | POST | `/api/member/info/create` |
| 修改 | POST | `/api/member/info/update` |
| 删除 | POST | `/api/member/info/delete?id=<id>` |

参数是 query 还是 body 由 `@RequestParam` / `@RequestBody` 决定，Knife4j 会自动生成对应的输入区。

### 7.3 按顺序调

1. `create`，body：

```json
{
  "memberNo": "M20261115001",
  "realName": "伊藤眠",
  "nickname": "眠",
  "mobile": "13800000001",
  "email": "test@zhiwei.com",
  "gender": 1,
  "registerSource": "admin",
  "status": 1
}
```

2. 响应 `code=0` 后，用 `page` 查出来拿到雪花 ID（或直接查库 `SELECT id, member_no FROM member_info;`）
3. `get?id=<id>` 确认字段都对
4. `update` 改昵称，再 `get` 看是否变了
5. `delete?id=<id>`，然后 `page` 确认列表里没了、库里 `deleted=id`

### 7.4 经网关再验一遍

```powershell
curl http://localhost:48080/api/member/info/page?page=1 -H "Authorization: Bearer <token>"
```

网关路由是 `Path=/api/member/**`、不带 StripPrefix，所以路径原样传给 member。网关 502/404 先看网关路由和 Nacos 里 member 有没有注册上去（`http://localhost:18080/` → 服务列表）。

### 7.5 常见拦截

- 没带 Token → 401，JSON 响应体里有提示
- 带 Token 但报「用户没找到」→ ID 无效，或语言是英文，加 header `language: zh-CN`
- 带 Token 但 403 → 权限码没登记、或 admin 角色没勾按钮（4.3 节）

## 八、第 6 步：门禁与提交

### 8.1 装 hook

新克隆/新分支只装一次：

```powershell
bash zhiwei-ai-governance/gates/install-hooks.sh
```

装完后每次 `git commit` 自动跑 `gate-backend.sh --hook`。

### 8.2 手动跑门禁

```powershell
bash zhiwei-ai-governance/gates/gate-backend.sh
```

7 项（第 9 章第 五 节详述）：`check_i18n` / `check_error_rules` / `check_naming` / `check_method_order` / `check_inline_queries` / `check_doc_refs` / `check_api_permissions`。

member 代码最容易踩的：

| 检查项 | 容易踩的写法 |
|---|---|
| check_api_permissions | 接口方法漏 `@PreAuthorize`；权限码没在 SQL 里登记；写成 `hasAuthority('a') or hasAuthority('b')` |
| check_method_order | `private` 辅助方法写在了 `public` 前面 |
| check_error_rules | 抛 `RuntimeException` 或 `new ServiceException(500, ...)`，没用 `ErrorCode` |
| check_inline_queries | 在 Service 里手写 `baseMapper.selectList(new QueryWrapper<...>()...)` 的复杂 SQL，应该抽成 Mapper 方法 |

### 8.3 提交

```powershell
git add -A
git commit -m "feat(member): member_info 增删改查接口"
git push origin c-1.2
```

pre-commit 会跑门禁，跑不过不让提交（`--no-verify` 能跳过，但正式 CI 没落地，别用）。

### 8.4 合 master

- 先 `git fetch origin && git merge origin/master`，冲突重点：根 `pom.xml`、`sql/base/20261102_03_zhiwei_base_init_data.sql`、`sql/member/` 目录。
- 合并后重跑 `mvn clean install -DskipTests` + 门禁，再提 PR/合并。

## 九、常见错误速查

| 现象 | 原因 | 修 |
|---|---|---|
| 启动报「JWT 签名密钥未配置」 | `.env` 里 `JWT_SECRET` 为空 | `openssl rand -hex 32` 生成 64 位，填进 `.env` |
| 启动报密钥不足 32 字节 | `JWT_SECRET` 太短 | 同上，64 个 hex 字符 |
| `Failed to configure a DataSource` | `.env` 没读到，或 `DB_HOST` 空 | 工作目录设仓库根；确认 `.env` 在根目录 |
| Nacos 注册报 401 / `User not found` | Nacos 3.x 开了鉴权 | compose 里应已设 `NACOS_AUTH_ENABLE=false`，检查 compose 是否被你本地改坏 |
| Redis `ERR AUTH ... called without any password` | `.env` 的 `REDIS_PASS` 是空串，Redisson 当成「配了密码」 | member 的 `application-dev.yml` 里那行 password 注释掉（文件里有说明） |
| 接口 401 | 没带 Token / Token 过期 / 服务间 `JWT_SECRET` 不一致 | 重登；三个服务用同一份 `.env` |
| 接口 403 | 权限码没登记 / 角色没勾按钮 | 第四节 4.2、4.3 |
| `can not find lambda cache for this entity` | 用 `LambdaUpdateWrapper` 做逻辑删除 | 用 `logicDeleteById` |
| 新增报 `Duplicate entry 'Mxxx-0' for key 'uk_member_no'` | `member_no` 重复 | 换一个编号；删除后用同号要确认 `deleted` 已变 |
| MapStruct 编译报 `Unmapped target property` | `MemberInfoRes` 里有 Entity 没有的字段 | 给 Converter 加 `@Mapping`，或删掉 Res 里多余字段 |
| 门禁 `check_api_permissions` 报权限码不存在 | 忘了 4.2 的 SQL | 补 SQL（库里也要执行） |
| 门禁 `check_method_order` 报顺序 | private 在前 | 调顺序 |
| `@FeignClient` 启动报 `@RequestMapping annotation not allowed on @FeignClient interfaces` | 接口上写了类级 `@RequestMapping` | 挪进 `path=`（坑 #14） |

## 十、验收清单

- [ ] 分支从 master 拉出（不是改 c-1.1）
- [ ] 新库 `test-16` 建好 6 张 member 表
- [ ] `.env` 指向新库，`member-server` 在 48083 起来
- [ ] `curl http://localhost:48083/api/member/health` 返回 200
- [ ] Swagger 里 5 个接口按 create → get → update → delete → page 全通
- [ ] 经网关 48080 再验一遍
- [ ] 权限码已登记到 SQL + 库，admin 角色已授权，403 消失
- [ ] `gate-backend.sh` 7/7 PASS
- [ ] 提交到 `c-1.x` 并合并 master
